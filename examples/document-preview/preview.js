// Self-contained classic script. Real plugins bundle their own PDF.js/docx-preview here.
window.addEventListener('message', event => {
  if (event.data?.type !== 'notegen:preview-init' || event.data.protocol !== 1 || !event.ports[0]) return
  const port = event.ports[0]
  let id = 0
  const pending = new Map()
  port.onmessage = ({ data }) => {
    const task = pending.get(data.id)
    if (!task) return
    pending.delete(data.id)
    data.error ? task.reject(new Error(data.error)) : task.resolve(data.result)
  }
  const request = fields => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    port.postMessage({ ...fields, id })
  })
  const main = document.createElement('main')
  document.body.append(main)
  main.style.cssText = 'max-width:720px;margin:32px auto;padding:32px;background:#fff;color:#222;border:1px solid #ddd;font:16px/1.6 system-ui'
  Promise.all([
    request({ method: 'readDocument', offset: 0, length: 1048576 }),
    request({ method: 'readAsset', path: 'caption.txt' })
  ]).then(([bytes, caption]) => {
    const heading = document.createElement('h1')
    heading.textContent = event.data.name
    const pre = document.createElement('pre')
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = new TextDecoder().decode(bytes)
    const footer = document.createElement('footer')
    footer.textContent = new TextDecoder().decode(caption)
    main.append(heading, pre, footer)
  }).catch(error => { main.textContent = error.message })
}, { once: true })
