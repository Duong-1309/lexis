import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

// GitHub release URL for yt-dlp
const YTDLP_RELEASES_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

function getBinaryName(): string {
  const platform = process.platform
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  return 'yt-dlp_linux'
}

function getDownloadUrl(): string {
  return `${YTDLP_RELEASES_URL}/${getBinaryName()}`
}

export function getYtDlpBinDir(): string {
  return path.join(app.getPath('userData'), 'bin')
}

export function getYtDlpPath(): string {
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return path.join(getYtDlpBinDir(), binaryName)
}

export function isYtDlpDownloaded(): boolean {
  return fs.existsSync(getYtDlpPath())
}

export async function verifyYtDlp(): Promise<boolean> {
  const ytdlpPath = getYtDlpPath()
  if (!fs.existsSync(ytdlpPath)) return false

  try {
    await execFileAsync(ytdlpPath, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export interface DownloadProgress {
  stage: 'downloading' | 'verifying' | 'done' | 'error'
  percent: number
  error?: string
}

// Follow redirects recursively (GitHub uses multiple redirects)
function httpsGetFollowRedirects(
  url: string,
  callback: (response: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined>, statusCode?: number }) => void,
  onError: (err: Error) => void,
  maxRedirects = 5
): void {
  if (maxRedirects <= 0) {
    onError(new Error('Too many redirects'))
    return
  }

  const parsedUrl = new URL(url)
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    headers: {
      'User-Agent': 'Lexis-App',
    },
  }

  https.get(options, (response) => {
    if (response.statusCode === 302 || response.statusCode === 301) {
      const redirectUrl = response.headers.location
      if (!redirectUrl) {
        onError(new Error('Redirect without location header'))
        return
      }
      // Follow redirect
      httpsGetFollowRedirects(redirectUrl, callback, onError, maxRedirects - 1)
      return
    }
    callback(response as NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined>, statusCode?: number })
  }).on('error', onError)
}

export async function downloadYtDlp(
  onProgress: (progress: DownloadProgress) => void
): Promise<void> {
  const binDir = getYtDlpBinDir()
  const ytdlpPath = getYtDlpPath()

  // Create bin directory if it doesn't exist
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  const url = getDownloadUrl()

  return new Promise((resolve, reject) => {
    onProgress({ stage: 'downloading', percent: 0 })

    const file = fs.createWriteStream(ytdlpPath)

    httpsGetFollowRedirects(
      url,
      (response) => {
        handleDownload(response, file, onProgress, ytdlpPath, resolve, reject)
      },
      (err) => {
        fs.unlink(ytdlpPath, () => {})
        reject(err)
      }
    )
  })
}

function handleDownload(
  response: NodeJS.ReadableStream & { headers?: { 'content-length'?: string }, statusCode?: number },
  file: fs.WriteStream,
  onProgress: (progress: DownloadProgress) => void,
  ytdlpPath: string,
  resolve: () => void,
  reject: (err: Error) => void
): void {
  const totalSize = parseInt(response.headers?.['content-length'] || '0', 10)
  let downloadedSize = 0

  response.on('data', (chunk: Buffer) => {
    downloadedSize += chunk.length
    const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
    onProgress({ stage: 'downloading', percent })
  })

  response.pipe(file)

  file.on('finish', async () => {
    file.close()

    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(ytdlpPath, 0o755)
      } catch (err) {
        reject(new Error(`Failed to make yt-dlp executable: ${err}`))
        return
      }
    }

    // On macOS, remove quarantine attribute to prevent Gatekeeper from blocking
    if (process.platform === 'darwin') {
      try {
        await execAsync(`xattr -d com.apple.quarantine "${ytdlpPath}"`)
        console.log('Removed quarantine attribute from yt-dlp')
      } catch {
        // Quarantine attribute may not exist, which is fine
        console.log('No quarantine attribute to remove (or already removed)')
      }
    }

    // Verify the binary works
    onProgress({ stage: 'verifying', percent: 100 })

    // Check file size
    const stats = fs.statSync(ytdlpPath)
    console.log(`Downloaded yt-dlp: ${stats.size} bytes`)

    if (stats.size < 1000000) {
      // File too small, likely an error page
      const content = fs.readFileSync(ytdlpPath, 'utf-8').slice(0, 500)
      console.log('File content:', content)
      fs.unlink(ytdlpPath, () => {})
      reject(new Error(`Download failed: file too small (${stats.size} bytes)`))
      return
    }

    // Small delay to let macOS finish processing the new binary
    await new Promise(r => setTimeout(r, 1000))

    try {
      const { stdout } = await execFileAsync(ytdlpPath, ['--version'], { timeout: 30000 })
      console.log('yt-dlp version:', stdout.trim())
      onProgress({ stage: 'done', percent: 100 })
      resolve()
    } catch (err) {
      console.log('Verification failed:', err)
      // Don't delete - keep for debugging
      reject(new Error(`Downloaded yt-dlp is not working: ${err}`))
    }
  })

  file.on('error', (err) => {
    fs.unlink(ytdlpPath, () => {})
    reject(err)
  })
}

export async function deleteYtDlp(): Promise<void> {
  const ytdlpPath = getYtDlpPath()
  if (fs.existsSync(ytdlpPath)) {
    fs.unlinkSync(ytdlpPath)
  }
}
