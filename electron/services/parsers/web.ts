import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export interface WebArticle {
  title: string
  text: string
}

export function parseArticleHtml(html: string, url: string): WebArticle {
  const dom = new JSDOM(html, { url })
  const article = new Readability(dom.window.document).parse()
  const heading = dom.window.document.querySelector('article h1, h1')?.textContent?.trim()
  const title = heading || article?.title?.trim() || dom.window.document.title.trim() || new URL(url).hostname
  const text = article?.textContent?.trim()

  if (!text) {
    throw new Error('Could not extract readable article text')
  }

  return { title, text }
}

export async function fetchWebArticle(url: string): Promise<WebArticle> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Lexis/1.0 (+https://lexis.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!response.ok) {
      throw new Error(`Web import failed: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    return parseArticleHtml(html, parsed.toString())
  } finally {
    clearTimeout(timeout)
  }
}
