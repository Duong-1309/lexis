import fs from 'fs'
import path from 'path'
import { JSDOM } from 'jsdom'
import log from 'electron-log'
import type { EPUBChapter } from '../../../src/types/index'

// JSZip is bundled with epubjs
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as {
  loadAsync(data: Buffer): Promise<JSZipInstance>
}

interface JSZipFile {
  async(type: 'string'): Promise<string>
  async(type: 'nodebuffer'): Promise<Buffer>
}

interface JSZipInstance {
  file(name: string): JSZipFile | null
  files: Record<string, JSZipFile>
}

async function loadZip(filePath: string): Promise<JSZipInstance> {
  const data = fs.readFileSync(filePath)
  return JSZip.loadAsync(data)
}

async function getOPFPath(zip: JSZipInstance): Promise<string> {
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('Invalid EPUB: missing META-INF/container.xml')
  const xml = await containerFile.async('string')
  const dom = new JSDOM(xml, { contentType: 'text/xml' })
  const fullPath = dom.window.document.querySelector('rootfile')?.getAttribute('full-path')
  if (!fullPath) throw new Error('Invalid EPUB: no OPF path in container.xml')
  return fullPath
}

function zipDir(filePath: string): string {
  return filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : ''
}

function joinZipPath(dir: string, file: string): string {
  if (file.startsWith('/')) return file.slice(1)
  return dir ? `${dir}/${file}` : file
}

function normalizePath(p: string): string {
  const parts = p.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

export async function parseEPUBChapters(filePath: string): Promise<EPUBChapter[]> {
  const zip = await loadZip(filePath)

  if (zip.file('META-INF/encryption.xml')) {
    throw new Error('This EPUB is DRM-protected and cannot be opened. Remove DRM protection before importing.')
  }

  const opfPath = await getOPFPath(zip)
  const opfDir = zipDir(opfPath)

  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('Invalid EPUB: cannot read OPF file')
  const opfXml = await opfFile.async('string')

  const opfDom = new JSDOM(opfXml, { contentType: 'text/xml' })
  const doc = opfDom.window.document

  // Build manifest map: id → { href, mediaType }
  const manifest = new Map<string, { href: string; mediaType: string }>()
  doc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id') ?? ''
    const href = item.getAttribute('href') ?? ''
    const mediaType = item.getAttribute('media-type') ?? ''
    if (id) manifest.set(id, { href, mediaType })
  })

  // Build a title map from NCX toc (href → title)
  const titleMap = new Map<string, string>()
  const tocId = doc.querySelector('spine')?.getAttribute('toc')
  const tocEntry = tocId ? manifest.get(tocId) : null
  if (tocEntry) {
    const tocZipPath = normalizePath(joinZipPath(opfDir, tocEntry.href))
    const tocFile = zip.file(tocZipPath)
    if (tocFile) {
      const tocXml = await tocFile.async('string')
      const tocDom = new JSDOM(tocXml, { contentType: 'text/xml' })
      tocDom.window.document.querySelectorAll('navPoint').forEach((navPoint) => {
        const src = navPoint.querySelector('content')?.getAttribute('src') ?? ''
        const title = navPoint.querySelector('navLabel > text')?.textContent?.trim() ?? ''
        if (src && title) {
          const href = normalizePath(src.split('#')[0])
          titleMap.set(href, title)
          titleMap.set(href.split('/').pop() ?? href, title)
        }
      })
    }
  }

  // Build chapter list from spine
  const chapters: EPUBChapter[] = []
  let order = 0
  doc.querySelectorAll('spine > itemref').forEach((itemref) => {
    const idref = itemref.getAttribute('idref') ?? ''
    const entry = manifest.get(idref)
    if (!entry) return
    if (!entry.mediaType.includes('html') && !entry.mediaType.includes('xhtml')) return

    const href = entry.href
    const shortHref = href.split('/').pop() ?? href
    const title = titleMap.get(href) ?? titleMap.get(shortHref) ?? `Chapter ${order + 1}`
    chapters.push({ id: idref, title, order })
    order++
  })

  log.info(`Parsed EPUB: ${chapters.length} chapters in ${path.basename(filePath)}`)
  return chapters
}

export async function loadEPUBChapter(filePath: string, chapterId: string): Promise<string> {
  const zip = await loadZip(filePath)
  const opfPath = await getOPFPath(zip)
  const opfDir = zipDir(opfPath)

  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('Cannot read OPF file')
  const opfXml = await opfFile.async('string')

  const opfDom = new JSDOM(opfXml, { contentType: 'text/xml' })
  const itemEl = opfDom.window.document.querySelector(`manifest > item[id="${chapterId}"]`)
  if (!itemEl) throw new Error(`Chapter "${chapterId}" not found in manifest`)

  const href = itemEl.getAttribute('href') ?? ''
  const chapterZipPath = normalizePath(joinZipPath(opfDir, href))

  const chapterFile = zip.file(chapterZipPath)
  if (!chapterFile) throw new Error(`Chapter file not found in EPUB archive: ${chapterZipPath}`)

  const html = await chapterFile.async('string')
  const dom = new JSDOM(html, { contentType: 'text/html' })
  const body = dom.window.document.body

  body.querySelectorAll('script, style').forEach((el) => el.remove())

  // Inline images as base64 — EPUB images live inside the ZIP and can't be
  // served via regular file paths in the renderer.
  const chapterDir = zipDir(chapterZipPath)
  const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp',
  }
  await Promise.all(
    Array.from(body.querySelectorAll('img[src]')).map(async (img) => {
      const src = img.getAttribute('src')
      if (!src || src.startsWith('data:') || src.startsWith('http')) return
      const imgZipPath = normalizePath(joinZipPath(chapterDir, src))
      const imgFile = zip.file(imgZipPath)
      if (!imgFile) { img.remove(); return }
      try {
        const buf = await imgFile.async('nodebuffer')
        const ext = path.extname(imgZipPath).toLowerCase().slice(1)
        const mime = MIME[ext] ?? 'image/jpeg'
        img.setAttribute('src', `data:${mime};base64,${buf.toString('base64')}`)
        img.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0 auto')
      } catch {
        img.remove()
      }
    }),
  )

  return body.innerHTML
}
