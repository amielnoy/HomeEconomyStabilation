interface ScalarApiReference {
  createApiReference(selector: string, options: Readonly<Record<string, unknown>>): void;
}

declare const Scalar: ScalarApiReference;

Scalar.createApiReference('#scalar-api-reference', {
  url: '/openapi.json',
  theme: 'kepler',
  layout: 'modern',
  showDeveloperTools: 'never',
  hideClientButton: true,
  agent: { disabled: true },
  mcp: { disabled: true },
  persistAuth: false,
  telemetry: false,
  withDefaultFonts: false,
  modelsSectionLabel: 'Schemas',
});

export {};
