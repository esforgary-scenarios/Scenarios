// onnxruntime-web 1.21.0 ships this declaration but omits it from package exports.
// Preserve the upstream API types under TypeScript's bundler module resolution.
declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common'
}
