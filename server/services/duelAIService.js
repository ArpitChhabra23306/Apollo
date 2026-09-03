import openai from '../config/ai.js';

const MODEL = 'gpt-4o-mini';

/**
 * Generates a complete LeetCode-style DSA problem formatted for the Duel Arena.
 * Supports custom admin prompt or difficulty preset (Easy, Medium, Hard).
 *
 * @param {Object} options
 * @param {string} [options.prompt] - Optional custom problem description or concept from admin.
 * @param {string} [options.difficulty='Medium'] - 'Easy' | 'Medium' | 'Hard'
 * @param {string} [options.topic='Algorithms'] - Topic tag like 'Arrays', 'Strings', 'DP', etc.
 * @returns {Promise<Object>} Formatted problem schema
 */
export async function generateDuelProblem({ prompt, difficulty = 'Medium', topic = 'Algorithms' }) {
  const systemPrompt = `
You are Apollo DSA Arena Architect, an expert competitive programming problem setter like LeetCode and Codeforces.
Create an engaging, clean algorithmic problem suitable for a competitive 1v1 speed duel.

CRITICAL REQUIREMENTS:
1. The problem must have a single primary function name (e.g. "solve", "maxProfit", "twoSum", "isValid").
2. Inputs and outputs must be standard JSON-compatible values (e.g., numbers, strings, arrays, booleans) or easily parsed representations.
3. Provide realistic starter code templates for:
   - javascript (e.g. function solve(nums) { ... })
   - python (e.g. def solve(nums): ...)
   - cpp (e.g. class Solution { public: ... };)
   - java (e.g. class Solution { public ... };)
4. Provide exactly 2 visible sample test cases (isHidden: false) and at least 4 hidden evaluation test cases (isHidden: true) covering edge cases (empty, single element, large numbers, negatives).
5. All testCases "input" MUST be formatted as valid JSON string or comma-separated argument representation that can be evaluated or fed to the function.
6. Return ONLY a valid JSON object matching the schema below. No markdown formatting, no code fences.

JSON Schema:
{
  "title": "Problem Title",
  "difficulty": "Easy" | "Medium" | "Hard",
  "topic": "Topic Name",
  "timeLimitMinutes": 20 | 30 | 45,
  "description": "Clear problem statement explaining the task, inputs, and outputs.",
  "examples": [
    {
      "input": "...",
      "output": "...",
      "explanation": "..."
    }
  ],
  "constraints": [
    "1 <= nums.length <= 10^4",
    "-10^9 <= nums[i] <= 10^9"
  ],
  "functionName": "functionName",
  "starterCode": {
    "javascript": "function functionName(...) {\\n  // Write your solution\\n}",
    "python": "def functionName(...):\\n    # Write your solution\\n    pass",
    "cpp": "class Solution {\\npublic:\\n    // ...\\n};",
    "java": "class Solution {\\n    // ...\\n}"
  },
  "testCases": [
    {
      "id": 1,
      "input": "[2, 7, 11, 15], 9",
      "expected": "[0, 1]",
      "isHidden": false,
      "explanation": "Because nums[0] + nums[1] == 9, we return [0, 1]."
    },
    {
      "id": 2,
      "input": "[3, 2, 4], 6",
      "expected": "[1, 2]",
      "isHidden": false
    },
    {
      "id": 3,
      "input": "[3, 3], 6",
      "expected": "[0, 1]",
      "isHidden": true
    },
    {
      "id": 4,
      "input": "...",
      "expected": "...",
      "isHidden": true
    },
    {
      "id": 5,
      "input": "...",
      "expected": "...",
      "isHidden": true
    },
    {
      "id": 6,
      "input": "...",
      "expected": "...",
      "isHidden": true
    }
  ]
}
`;

  let userPrompt = '';
  if (prompt && prompt.trim()) {
    userPrompt = `Admin Request: Create a ${difficulty} difficulty competitive problem based on this concept: "${prompt.trim()}". Ensure high quality test cases and clean starter templates.`;
  } else {
    userPrompt = `Create an original ${difficulty} difficulty problem on the topic of "${topic}". It should test algorithmic problem-solving under time pressure. Include 2 visible and 4 hidden edge-case tests.`;
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);

  // Validate & normalize critical fields
  if (!parsed.title || !parsed.starterCode) {
    throw new Error('AI generated invalid problem structure');
  }

  if (!parsed.functionName) {
    const match = (parsed.starterCode?.javascript || '').match(/function\s+([a-zA-Z0-9_]+)/);
    parsed.functionName = match ? match[1] : 'solve';
  }

  if (!Array.isArray(parsed.testCases) || parsed.testCases.length === 0) {
    throw new Error('AI failed to generate test cases for problem');
  }

  parsed.testCases = parsed.testCases.map((t, idx) => ({
    id: t.id || (idx + 1),
    input: typeof t.input === 'object' ? JSON.stringify(t.input) : String(t.input ?? ''),
    expected: typeof t.expected === 'object' ? JSON.stringify(t.expected) : String(t.expected ?? ''),
    isHidden: idx >= 2 || !!t.isHidden,
    explanation: t.explanation || '',
  }));

  return parsed;
}
