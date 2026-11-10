// Real-browser end-to-end test of the complete BatteryX workflow (Chrome/Edge via puppeteer-core).
// Needs the backend and the frontend dev server running. Saves screenshots of every step.
//
//   E2E_URL=http://localhost:5174 CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node e2e/workflow.e2e.mjs
//
// Fails on any uncaught page error, console error or failed step.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const URL = process.env.E2E_URL || 'http://localhost:5173'
const OUT = process.env.E2E_SCREENSHOTS || path.resolve('../docs/screenshots')
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROJECT = `E2E solar module ${new Date().toISOString().slice(0, 16)}`
fs.mkdirSync(OUT, { recursive: true })

const errors = []
const results = []
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1440,960', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 960 })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|React Router Future/.test(m.text())) errors.push(`console: ${m.text()}`) })
page.on('dialog', (d) => d.accept())

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function clickText(text, { tag = 'button', timeout = 20000 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate((text, tag) => {
      const el = [...document.querySelectorAll(tag)].find((b) => b.textContent.replace(/\s+/g, ' ').includes(text) && !b.disabled)
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true }
      return false
    }, text, tag)
    if (ok) return
    await sleep(200)
  }
  throw new Error(`no enabled <${tag}> containing "${text}"`)
}
async function waitText(text, timeout = 60000) {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text)
}
async function step(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ step: name, ok: true, ms: Date.now() - t0 })
    console.log(`✓ ${name} (${Date.now() - t0} ms)`)
  } catch (e) {
    results.push({ step: name, ok: false, error: e.message })
    console.log(`✗ ${name}: ${e.message}`)
    await page.screenshot({ path: path.join(OUT, `FAILED-${name.replace(/\W+/g, '_')}.png`) })
  }
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
// screenshot of one panel (section with the given heading) — clean images for slides and documentation
async function panel(name, title) {
  const el = await page.evaluateHandle((t) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h3')?.textContent.trim() === t), title)
  const box = el.asElement()
  if (!box) throw new Error(`panel "${title}" not found`)
  await box.scrollIntoView()
  await sleep(300)
  await box.screenshot({ path: path.join(OUT, `${name}.png`) })
}
const go = async (route) => { await page.goto(URL + route, { waitUntil: 'networkidle0' }) }

await step('landing page shows live backend status', async () => {
  await go('/')
  await waitText('online · v')
  await waitText('registered')
  await shot('01-landing')
})
await step('create project', async () => {
  await go('/app/projects')
  await page.waitForSelector('input[placeholder="Solar storage module"]')
  await page.type('input[placeholder="Solar storage module"]', PROJECT)
  await page.type('input[placeholder="12 V stationary solar storage, outdoor"]', '12 V outdoor solar storage (illustrative stage-1 scenario)')
  await clickText('Create project')
  await waitText('Designs')
})
await step('configure: load stage-1 designs A/B/C and evaluate all', async () => {
  await clickText('Load stage-1 examples A/B/C')
  await waitText('C - Parallel 4S2P')
  await clickText('Evaluate all designs')
  await waitText('409.6')
  await waitText('Saved', 15000)
  await panel('02-project-designs', 'Designs')
})
await step('wizard: walk the steps and evaluate', async () => {
  await go('/app/wizard')
  await clickText('Thermal')
  await waitText('Thermal resistance cell → ambient')
  await clickText('Review')
  await clickText('Evaluate design')
  await waitText('Safety checks')
  await panel('03-wizard-review', '8. Review')
})
await step('cell selection shows provenance and missing data', async () => {
  await go('/app/cells')
  await waitText('Data completeness')
  await shot('04-cells')
})
await step('series-parallel live sizing', async () => {
  await go('/app/topology')
  await waitText('12.8')
  await shot('05-topology')
})
await step('run electrical simulation', async () => {
  await go('/app/electrical')
  await clickText('Run charge & discharge simulation')
  await waitText('Reached target SOC')
  await page.waitForSelector('.recharts-line')
  await panel('06-electrical-results', 'Results')
})
await step('thermal analysis + current sweep', async () => {
  await go('/app/thermal')
  await clickText('Run thermal analysis')
  await waitText('Time constant τ')
  await clickText('Run sweep')
  await page.waitForFunction(() => document.querySelectorAll('.recharts-line').length >= 2, { timeout: 60000 })
  await panel('07-thermal-transient', 'Temperature transient (coupled simulation)')
  await panel('07b-thermal-sweep', 'Peak temperature vs charge current')
})
await step('identify safety warnings (design B)', async () => {
  await go('/app/safety')
  await page.waitForSelector('select[aria-label="Active design"]')
  await page.select('select[aria-label="Active design"]', 'B - Fast charge + spreader')
  await clickText('Run safety checks')
  await waitText('Max safe charge current')
  await page.waitForFunction(() => [...document.querySelectorAll('span')].some((s) => s.textContent.trim() === 'WARN'))
  await panel('08-safety-rule-checks-B', 'Rule checks')
})
await step('mechanical packaging with 3D view', async () => {
  await go('/app/packaging')
  await clickText('Run packaging analysis')
  await page.waitForSelector('canvas', { timeout: 60000 })
  await sleep(2500)
  const painted = await page.evaluate(() => { const c = document.querySelector('canvas'); return !!c && c.width > 100 && c.height > 100 })
  if (!painted) throw new Error('3D canvas not rendered')
  await panel('09-packaging-3d', '3D module view')
})
await step('compare alternative designs', async () => {
  await go('/app/compare')
  await clickText('Run comparison')
  await waitText('Recommended by the comparison engine')
  await panel('10-compare-recommendation', 'Recommendation')
  await panel('10b-compare-ranking', 'Ranking')
  await panel('10c-compare-metric', 'Metric explorer')
  await panel('10d-compare-deltas', 'Change vs baseline')
})
await step('AI recommendations page', async () => {
  await go('/app/assistant')
  await waitText('AI Design Copilot')
  await shot('11-ai-copilot')
})
await step('generate engineering report', async () => {
  await go('/app/report')
  await clickText('Generate report')
  await waitText('Design inputs and provenance', 90000)
  await waitText('Computed by (model)')
  const rep = await page.$('article'); await rep.screenshot({ path: path.join(OUT, '12-report.png') })
})
await step('mobile layout renders (390 px)', async () => {
  await page.setViewport({ width: 390, height: 844 })
  await go('/app/compare')
  await sleep(500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await shot('13-mobile-compare')
  if (overflow > 2) throw new Error(`horizontal page overflow ${overflow}px at 390 px`)
})

// clean up the e2e project
await page.setViewport({ width: 1440, height: 960 })
await go('/app/projects')
await page.evaluate(async (name) => {
  const ps = await (await fetch('/api/v1/projects')).json()
  for (const p of ps.filter((x) => x.name === name)) await fetch(`/api/v1/projects/${p.id}`, { method: 'DELETE' })
}, PROJECT)
await browser.close()

fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ url: URL, at: new Date().toISOString(), results, errors }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed; ${errors.length} browser errors`)
errors.forEach((e) => console.log('  ' + e))
process.exit(failed.length || errors.length ? 1 : 0)
