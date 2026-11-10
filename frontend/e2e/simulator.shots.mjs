// Captures the live-simulator screenshots used in docs/screenshots and the presentation.
//   E2E_URL=http://localhost:5175 node e2e/simulator.shots.mjs
// Needs a running frontend (npm run build && npx vite preview --port 5175). The simulator runs in the
// browser, so the backend does not need to be up.
import puppeteer from 'puppeteer-core'

const URL = process.env.E2E_URL || 'http://localhost:5175'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = new globalThis.URL('../../docs/screenshots/', import.meta.url)
const shot = (n) => decodeURIComponent(new globalThis.URL(n, OUT).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1600,1000'] })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${URL}/app/simulator`, { waitUntil: 'networkidle0' })

const clickText = async (txt) => {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t))
    if (b) b.click()
    return !!b
  }, txt)
  if (!ok) throw new Error(`button not found: ${txt}`)
  await sleep(500)
}

await clickText('Start the guided simulation')
await clickText('Next')
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(400)
await page.screenshot({ path: shot('14-simulator-guided.png') })

await page.addStyleTag({ content: 'header.sticky { position: static !important; }' })
const graph = await page.$('.bw .graph-card')
await graph.scrollIntoView()
await sleep(1500)
await graph.screenshot({ path: shot('15-simulator-dependency-graph.png') })

console.log(JSON.stringify({ ok: errors.length === 0, errors }))
await browser.close()
