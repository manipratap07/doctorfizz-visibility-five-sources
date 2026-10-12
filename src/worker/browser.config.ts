export type BrowserTarget = {
  url: string;
  input: string;
  answer: string;
  completion: string;
  completionScope?: "answer" | "page";
  stop: string;
  answerText?: string;
  completionAncestor?: string;
  submit?: string;
  model?: string;
  search?: string;
  // Public browser navigation, never a private provider API call.
  queryUrl?: string;
};
const copy =
  'button[aria-label*="Copy" i],button[title*="Copy" i],button[data-tooltip*="Copy" i],button[mattooltip*="Copy" i],button[data-test-id="copy-button"],button:has(mat-icon:has-text("content_copy"))';
const stop =
  'button[aria-label*="Stop" i],button[title*="Stop" i],button[data-test-id="stop-button"],button:has(mat-icon:has-text("stop"))';
// Scoped candidate selectors. A completed VPS adapter probe is required for readiness.
// Gemini has returned a guest answer on the user's VPS; these DOM selectors still
// need acceptance against that live DOM. Never use whole-page text as an answer.
export const browserTargets: Record<string, BrowserTarget> = {
  chatgpt: {
    url: "https://chatgpt.com/",
    input:
      '#prompt-textarea,[contenteditable="true"][role="textbox"],textarea[placeholder*="Message" i]',
    answer: '[data-message-author-role="assistant"]',
    answerText: ".markdown",
    completion: copy,
    completionAncestor:
      'xpath=ancestor::*[starts-with(@data-testid,"conversation-turn")][1]',
    stop,
  },
  gemini: {
    url: "https://gemini.google.com/",
    input:
      'rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"],textarea[aria-label*="prompt" i]',
    answer:
      'model-response,[data-test-id="model-response"],[data-testid="assistant-message"]',
    answerText:
      'message-content,.model-response-text,[data-testid="answer-text"]',
    completion: 'button[aria-label="Copy"]',
    completionScope: "page",
    stop,
    model:
      '[data-test-id="bard-mode-menu-button"],button:has-text("Flash-Lite")',
    search: "text=/^Searching the web$/i",
  },
  copilot: {
    url: "https://copilot.microsoft.com/",
    input:
      'textarea[placeholder*="Message" i],textarea[placeholder*="Ask" i],textarea[aria-label*="Message" i]',
    answer:
      '[data-testid="chat-message-assistant"],[data-content="ai-message"]',
    completion: copy,
    stop,
  },
  "google-ai": {
    url: "https://www.google.com/ai",
    queryUrl: "https://www.google.com/search?udm=50",
    input:
      'textarea[name="q"],textarea[aria-label*="Ask" i],[contenteditable="true"][role="textbox"]',
    // Unknown Google UI fails closed; ordinary search links are never scored.
    answer:
      '[data-testid="ai-mode-answer"],[data-aimode-answer],[role="region"][aria-label="AI response"]',
    completion: copy,
    stop,
    search: "text=/^(Searching the web|Searching)$/i",
  },
  duckai: {
    url: "https://duck.ai/",
    input: 'textarea,[contenteditable="true"][role="textbox"]',
    submit: 'button:has-text("Ask")',
    answer: '[data-testid="assistant-message"],[data-role="assistant"]',
    completion: copy,
    stop,
  },
};
