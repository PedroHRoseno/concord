import { Fragment, type ReactNode } from 'react'

const looksLikeHtml = (value: string): boolean => /<\/?[a-z][\s\S]*?>/i.test(value)

/**
 * Converte o HTML das notas da release (que o GitHub entrega pronto) em elementos React.
 * Só tags conhecidas viram elementos e nenhum atributo é copiado: o resto vira apenas texto, sem risco de script.
 */
function render(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return text.trim() === '' && text.includes('\n') ? null : text
  }
  if (!(node instanceof HTMLElement)) return null
  const tag = node.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style') return null
  if (tag === 'br') return <br key={key} />
  const children = Array.from(node.childNodes).map((child, index) => render(child, `${key}.${index}`))
  switch (tag) {
    case 'p':
      return (
        <p key={key} className="mb-2 last:mb-0">
          {children}
        </p>
      )
    case 'ul':
      return (
        <ul key={key} className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
          {children}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
          {children}
        </ol>
      )
    case 'li':
      return <li key={key}>{children}</li>
    case 'strong':
    case 'b':
      return (
        <strong key={key} className="font-semibold text-ink">
          {children}
        </strong>
      )
    case 'em':
    case 'i':
      return <em key={key}>{children}</em>
    case 'code':
      return (
        <code key={key} className="rounded bg-black/30 px-1 py-0.5 text-xs text-ink">
          {children}
        </code>
      )
    case 'pre':
      return (
        <pre key={key} className="mb-2 overflow-x-auto rounded-lg bg-black/30 p-2 text-xs text-ink last:mb-0">
          {children}
        </pre>
      )
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return (
        <p key={key} className="mb-1 mt-2 font-semibold text-ink first:mt-0">
          {children}
        </p>
      )
    case 'a':
      return (
        <span key={key} className="text-blurple underline">
          {children}
        </span>
      )
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

export function ReleaseNotes({ notes }: { notes: string }) {
  if (!looksLikeHtml(notes)) return <p className="whitespace-pre-wrap">{notes}</p>
  const doc = new DOMParser().parseFromString(notes, 'text/html')
  return <>{Array.from(doc.body.childNodes).map((child, index) => render(child, String(index)))}</>
}
