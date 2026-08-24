interface SwaggerBundleFactory {
  (options: Readonly<Record<string, unknown>>): unknown;
  presets: { apis: unknown };
}

declare const SwaggerUIBundle: SwaggerBundleFactory;
declare const SwaggerUIStandalonePreset: unknown;

declare global {
  interface Window {
    ui?: unknown;
  }
}

window.addEventListener('load', () => {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    displayRequestDuration: true,
    persistAuthorization: false,
    tryItOutEnabled: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
  });
});

export {};
