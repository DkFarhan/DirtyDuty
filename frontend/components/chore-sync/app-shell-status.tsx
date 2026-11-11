import styles from "./app-shell-status.module.css"

export function AppShellLoading() {
  return (
    <div className={styles.screen} role="status">
      <span aria-hidden="true" className={styles.spinner} />
      <p className={styles.loadingMessage}>Loading...</p>
    </div>
  )
}

export function AppShellError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.screen}>
      <p className={styles.message} role="alert">
        {message}
      </p>
      <button className={styles.retry} onClick={onRetry} type="button">
        Try Again
      </button>
    </div>
  )
}
