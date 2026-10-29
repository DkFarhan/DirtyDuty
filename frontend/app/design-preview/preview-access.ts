export function isDesignPreviewEnabled(nodeEnvironment = process.env.NODE_ENV) {
  return nodeEnvironment === "development"
}
