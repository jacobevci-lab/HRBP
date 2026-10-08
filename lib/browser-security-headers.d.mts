export type BrowserSecurityHeader = {
  key: string;
  value: string;
};

export function browserSecurityHeaders(): BrowserSecurityHeader[];
