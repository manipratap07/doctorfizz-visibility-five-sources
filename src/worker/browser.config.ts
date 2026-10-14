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
  // Registrable domains owned by the provider: their links (help, terms, privacy,
  // internal redirects) are interface chrome, not citations.
  ownDomains?: string[];
  // Extra Chrome switches used only when the run goes through the proxy.
  proxyArgs?: string[];
};

// Through the residential proxy's CONNECT tunnel, Chrome's HTTP/2 sessions to
// Google front ends stall (page.goto never reaches domcontentloaded), while
// HTTP/1.1 loads in ~2 s. Measured on the VPS; ChatGPT keeps HTTP/2 because
// Cloudflare expects a normal Chrome protocol fingerprint.
const googleProxyArgs = ["--disable-http2"];

const copy =
  'button[aria-label*="Copy" i],button[title*="Copy" i],button[data-tooltip*="Copy" i],button[mattooltip*="Copy" i],button[data-test-id="copy-button"],button:has(mat-icon:has-text("content_copy"))';
const stop =
  'button[aria-label*="Stop" i],button[title*="Stop" i],button[data-test-id="stop-button"],button:has(mat-icon:has-text("stop"))';

// Scoped candidate selectors. A completed VPS adapter probe is required for readiness.
export const browserTargets: Record<string, BrowserTarget> = {
  chatgpt: {
    url: "https://chatgpt.com/",
    input:
      '#prompt-textarea,#mobile-composer-prompt,textarea[name="prompt"],[contenteditable="true"][role="textbox"],textarea[placeholder*="Ask ChatGPT" i],textarea[placeholder*="Message" i]',
    // The composer's own send button; while generating the same element turns
    // into "Stop generating", which this label filter never matches.
    submit: 'button[data-composer-submit][aria-label="Send message"]',
    answer:
      'li[data-message-role="assistant"],[data-message-author-role="assistant"]',
    answerText: "[data-assistant-markdown-root],.markdown",
    // The logged-out UI marks the assistant turn itself once streaming ends.
    completion: "xpath=self::*[@data-message-complete]",
    stop,
    ownDomains: ["chatgpt.com", "openai.com", "oaiusercontent.com"],
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
    // Copy must belong to the new response, not an older turn on the page.
    completionScope: "answer",
    // Read-aloud/audio "Stop" controls are unrelated to response generation.
    stop: 'button[aria-label="Stop" i],button[aria-label="Stop response" i],button[aria-label="Stop generating" i],button[data-test-id="stop-button"],button[data-test-id="stop-response-button"],button:has(mat-icon:text-is("stop")):not([aria-label*="read" i]):not([aria-label*="audio" i]):not([title*="read" i]):not([title*="audio" i])',
    model:
      '[data-test-id="bard-mode-menu-button"],button:has-text("Flash-Lite")',
    search: "text=/^Searching the web$/i",
    ownDomains: ["google.com", "gstatic.com", "googleusercontent.com"],
    proxyArgs: googleProxyArgs,
  },
  "google-ai": {
    // Type into the /ai page like a visitor. Opening search?udm=50&q=... directly
    // from a fresh profile is what triggered Google's /sorry/ page.
    url: "https://www.google.com/ai",
    input:
      'textarea[name="q"],textarea[aria-label*="Ask" i],[contenteditable="true"][role="textbox"]',
    // AI Mode turn root; Google sets data-complete="true" once rendering ends.
    answer: '[data-subtree="aimc"]',
    answerText: '[data-container-id="main-col"]',
    completion: 'xpath=self::*[@data-complete="true"]',
    stop,
    search: "text=/^(Searching the web|Searching)$/i",
    ownDomains: ["google.com", "google.co.in", "gstatic.com", "googleusercontent.com"],
    proxyArgs: googleProxyArgs,
  },
};
