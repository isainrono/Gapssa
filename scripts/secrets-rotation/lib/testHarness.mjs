// Arnés de pruebas mínimo, sin dependencias externas — mismo espíritu
// que lib.test.sh: contadores PASS/FAIL, un `run()` por caso, y un
// resumen final con exit code no cero si algo falló. Compartido por los
// `*.test.mjs` de este directorio.

let pass = 0
let fail = 0

/** @param {string} description @param {boolean} condition @returns {void} */
export function ok(description, condition) {
  if (condition) {
    pass += 1
    console.log(`ok   - ${description}`)
  } else {
    fail += 1
    console.log(`FAIL - ${description}`)
  }
}

/** @param {string} description @param {() => Promise<void>} fn @returns {Promise<void>} */
export function ranAsync(description, fn) {
  return fn()
    .then(() => ok(description, true))
    .catch((err) => {
      fail += 1
      console.log(`FAIL - ${description} (${err.message})`)
    })
}

/** @returns {void} */
export function summarizeAndExit() {
  console.log(`\n${pass} ok, ${fail} fallidas.`)
  process.exit(fail === 0 ? 0 : 1)
}
