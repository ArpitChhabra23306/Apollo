import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSafe, isWindows } from './execSafe.js';

const PYTHON_CMD = isWindows ? 'python' : 'python3';
const TEST_TIMEOUT_MS = 6000;

/**
 * Builds an isolated test driver script that runs the candidate code against all test cases.
 */
function buildHarness(code, language, functionName, testCases) {
  if (language === 'javascript') {
    return `
${code}

const tests = ${JSON.stringify(testCases)};
const results = [];

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return a == b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return String(a) === String(b);
  }
}

for (let i = 0; i < tests.length; i++) {
  const t = tests[i];
  let actual = null;
  let passed = false;
  let error = null;
  const start = Date.now();
  try {
    let args = [];
    try {
      args = JSON.parse('[' + t.input + ']');
    } catch {
      try {
        args = eval('[' + t.input + ']');
      } catch {
        args = [t.input];
      }
    }

    actual = ${functionName}(...args);

    let expectedVal = t.expected;
    try {
      expectedVal = JSON.parse(t.expected);
    } catch {
      try {
        expectedVal = eval('(' + t.expected + ')');
      } catch {}
    }
    passed = deepEqual(actual, expectedVal);
  } catch (err) {
    error = err.message;
  }
  const timeMs = Date.now() - start;
  results.push({
    id: t.id ?? (i + 1),
    passed: !!passed,
    input: t.input,
    expected: String(t.expected),
    actual: actual !== null && actual !== undefined ? (typeof actual === 'object' ? JSON.stringify(actual) : String(actual)) : (error ? 'Error: ' + error : 'undefined'),
    error,
    timeMs,
    isHidden: !!t.isHidden,
  });
}

console.log('__DUEL_RESULTS__' + JSON.stringify(results) + '__DUEL_RESULTS__');
`;
  }

  if (language === 'python') {
    return `
import json, time, sys

${code}

tests = json.loads('''${JSON.stringify(testCases)}''')
results = []

def deep_equal(a, b):
    if a == b: return True
    try:
        return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    except:
        return str(a) == str(b)

for i, t in enumerate(tests):
    actual = None
    passed = False
    err_msg = None
    start = time.time()
    try:
        try:
            args = json.loads("[" + t["input"] + "]")
        except:
            try:
                args = eval("(" + t["input"] + ",)")
            except:
                args = (t["input"],)
        
        actual = ${functionName}(*args)
        
        try:
            expected_val = json.loads(str(t["expected"]))
        except:
            try:
                expected_val = eval(str(t["expected"]))
            except:
                expected_val = t["expected"]
            
        passed = deep_equal(actual, expected_val)
    except Exception as e:
        err_msg = str(e)
    
    elapsed_ms = int((time.time() - start) * 1000)
    results.append({
        "id": t.get("id", i + 1),
        "passed": bool(passed),
        "input": t["input"],
        "expected": str(t["expected"]),
        "actual": (json.dumps(actual) if isinstance(actual, (dict, list)) else str(actual)) if err_msg is None else "Error: " + err_msg,
        "error": err_msg,
        "timeMs": elapsed_ms,
        "isHidden": bool(t.get("isHidden", False))
    })

print("__DUEL_RESULTS__" + json.dumps(results) + "__DUEL_RESULTS__")
`;
  }

  throw new Error(`Unsupported test runner language: ${language}. Supported languages for duel automated testing are javascript and python.`);
}

/**
 * Runs a solution against problem test cases in an isolated temporary sandbox.
 *
 * @param {Object} params
 * @param {string} params.code - User's code
 * @param {string} params.language - 'javascript' | 'python'
 * @param {Object} params.problem - Duel problem object with functionName and testCases
 * @param {boolean} [params.sampleOnly=false] - Only run visible sample test cases
 * @returns {Promise<{ ok: boolean, passedCount: number, totalCount: number, results: Array, isAllPassed: boolean, stdout: string, stderr: string }>}
 */
export async function evaluateDuelSubmission({ code, language, problem, sampleOnly = false }) {
  if (!code || !code.trim()) {
    return { ok: false, error: 'Code is empty', passedCount: 0, totalCount: 0, results: [], isAllPassed: false };
  }

  const allTests = problem.testCases || [];
  const testsToRun = sampleOnly ? allTests.filter((t) => !t.isHidden) : allTests;

  if (testsToRun.length === 0) {
    return { ok: true, passedCount: 0, totalCount: 0, results: [], isAllPassed: false };
  }

  const fnName = problem.functionName || 'solve';
  const harnessCode = buildHarness(code, language, fnName, testsToRun);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apollo-duel-'));
  const ext = language === 'javascript' ? 'js' : 'py';
  const fileName = `harness.${ext}`;
  const filePath = path.join(dir, fileName);

  try {
    await fs.writeFile(filePath, harnessCode, 'utf8');

    const cmd = language === 'javascript' ? 'node' : PYTHON_CMD;
    const args = language === 'javascript' ? [fileName] : ['-u', fileName];

    const result = await spawnSafe({
      cmd,
      args,
      cwd: dir,
      timeoutMs: TEST_TIMEOUT_MS,
    });

    let results = [];
    const marker = '__DUEL_RESULTS__';
    const firstIdx = result.stdout.indexOf(marker);
    const lastIdx = result.stdout.lastIndexOf(marker);

    if (firstIdx !== -1 && lastIdx > firstIdx) {
      const rawJson = result.stdout.slice(firstIdx + marker.length, lastIdx);
      try {
        results = JSON.parse(rawJson);
      } catch (err) {
        console.error('Failed to parse duel test results JSON:', err);
      }
    }

    // In case of syntax or runtime error before tests finished:
    if (!results.length && (result.stderr || result.exitCode !== 0)) {
      results = testsToRun.map((t, idx) => ({
        id: t.id || idx + 1,
        passed: false,
        input: t.input,
        expected: String(t.expected),
        actual: result.timedOut ? 'Execution Timed Out (TLE)' : (result.stderr.slice(0, 300) || 'Runtime Error'),
        error: result.timedOut ? 'Time Limit Exceeded' : result.stderr.slice(0, 300),
        isHidden: !!t.isHidden,
      }));
    }

    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    const isAllPassed = totalCount > 0 && passedCount === totalCount;

    return {
      ok: true,
      passedCount,
      totalCount,
      isAllPassed,
      results,
      stdout: result.stdout.replace(new RegExp(`__DUEL_RESULTS__[\\s\\S]*__DUEL_RESULTS__`, 'g'), '').trim(),
      stderr: result.stderr.trim(),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}
