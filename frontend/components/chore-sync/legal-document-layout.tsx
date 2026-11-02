import { ProductLogo } from "@/components/brand/product-logo"
import { LegalDocumentBackLink } from "@/components/chore-sync/legal-document-back-link"
import styles from "./legal-document-layout.module.css"

export type LegalDocumentSectionLink = {
  id: string
  label: string
}

type LegalDocumentLayoutProps = {
  title: "DirtyDuty Terms of Service" | "DirtyDuty Privacy Policy"
  eyebrow: "LEGAL DOCUMENTS" | "PRIVACY"
  effectiveDate: string
  children: React.ReactNode
}

export function LegalDocumentLayout({
  title,
  eyebrow,
  effectiveDate,
  children,
}: LegalDocumentLayoutProps) {
  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <div className={styles.headerInner}>
          <div className={styles.headerNav}>
            <LegalDocumentBackLink />
            <ProductLogo className={styles.logo} />
          </div>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.effectiveDate}>Effective date: {effectiveDate}</p>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}

export function LegalDocumentContents({ sections }: { sections: LegalDocumentSectionLink[] }) {
  return (
    <nav aria-label="On this page" className={styles.contents}>
      <details>
        <summary>On this page</summary>
        <ul>
          {sections.map(({ id, label }) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  )
}
