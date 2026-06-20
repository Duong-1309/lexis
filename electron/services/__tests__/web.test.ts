import { describe, expect, it } from 'vitest'
import { parseArticleHtml } from '../parsers/web'

describe('web parser', () => {
  it('extracts readable article title and text', () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Fallback title</title></head>
        <body>
          <article>
            <h1>Readable Title</h1>
            <p>This is the first paragraph of the article.</p>
            <p>This is the second paragraph with enough text to parse.</p>
          </article>
          <nav>Navigation should not matter.</nav>
        </body>
      </html>
    `

    const article = parseArticleHtml(html, 'https://example.com/article')
    expect(article.title).toContain('Readable Title')
    expect(article.text).toContain('first paragraph')
    expect(article.text).toContain('second paragraph')
    expect(article.text).not.toContain('Navigation')
  })

  it('throws when readable text cannot be extracted', () => {
    expect(() => parseArticleHtml('<html><head></head><body></body></html>', 'https://example.com'))
      .toThrow('Could not extract readable article text')
  })
})
