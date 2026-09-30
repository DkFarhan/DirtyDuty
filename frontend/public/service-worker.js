self.addEventListener("push", (event) => {
  if (!event.data) return

  const notification = event.data.json()
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { targetPath: notification.targetPath },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetPath = safeTargetPath(event.notification.data?.targetPath)
  const targetUrl = new URL(targetPath, self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const existing = windows.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin
      } catch {
        return false
      }
    })

    if (existing) {
      try {
        const navigated = await existing.navigate(targetUrl)
        await (navigated ?? existing).focus()
        return
      } catch (error) {
        console.warn("Unable to navigate the existing DirtyDuty window.", error)
      }
    }

    await self.clients.openWindow(targetUrl)
  })())
})

function safeTargetPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/"
  }
  try {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin) return "/"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}
