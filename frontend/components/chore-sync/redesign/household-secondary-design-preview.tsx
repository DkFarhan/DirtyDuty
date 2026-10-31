"use client"

import { useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Clock3,
  Ellipsis,
  House,
  LockKeyhole,
  Plus,
  Repeat2,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react"
import type { HouseholdInvitationSummary } from "@/lib/household/api"
import styles from "./household-secondary-design-preview.module.css"

type SecondaryScreen = "manage-chores" | "household-settings" | "chore-form"
export type PreviewTheme = "dark" | "light"
type ManageState = "loaded" | "empty" | "loading" | "error"
type PreviewRole = "OWNER" | "ADMIN" | "MEMBER"
type ChoreFormMode = "create" | "edit"

export function HouseholdLiveDesignHeader({
  eyebrow,
  title,
  household,
  onBack,
  heroEyebrow,
  heroTitle,
  heroDescription,
  heroIcon = "sparkles",
  action,
}: {
  eyebrow: string
  title: string
  household: string
  onBack: () => void
  heroEyebrow: string
  heroTitle: ReactNode
  heroDescription: string
  heroIcon?: "house" | "sparkles" | "repeat"
  action?: ReactNode
}) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerLine}>
          <button aria-label="Back" className={styles.backButton} onClick={onBack} type="button">
            <ArrowLeft aria-hidden="true" size={19} />
          </button>
          <div className={styles.identity}>
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <span>{household}</span>
          </div>
          {action && <div className={styles.headerAction}>{action}</div>}
        </div>
      </header>
      <div className={styles.liveContent}>
        <section className={styles.heroCard}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{heroEyebrow}</p>
            <h2>{heroTitle}</h2>
            <p>{heroDescription}</p>
          </div>
          <div aria-hidden="true" className={styles.heroOrb}>
            {heroIcon === "house" ? (
              <House size={30} />
            ) : heroIcon === "repeat" ? (
              <Repeat2 size={30} />
            ) : (
              <Sparkles size={29} />
            )}
          </div>
        </section>
      </div>
    </>
  )
}

const chores = [
  {
    title: "Reset the kitchen",
    category: "Kitchen",
    icon: "K",
    schedule: "Every day · 7:00 PM",
    assignment: "Rotate · 3 people",
    effort: "Moderate · 20 min",
    active: true,
  },
  {
    title: "Water the plants",
    category: "Garden",
    icon: "G",
    schedule: "Every Monday, Thursday",
    assignment: "Fixed · Salman",
    effort: "Light · 10 min",
    active: true,
  },
  {
    title: "Take out recycling",
    category: "Household",
    icon: "H",
    schedule: "Every Wednesday · 8:00 PM",
    assignment: "Random · 2 of 3 people",
    effort: "Quick · 5 min",
    active: false,
  },
]

const people = ["Salman", "Aisha", "You"]

const invitations = [
  {
    id: "invitation-aisha",
    createdAt: "2026-10-28T15:00:00.000Z",
    expiresAt: "2026-11-04T15:00:00.000Z",
    status: "ACTIVE",
    createdByDisplayName: "Aisha",
    roleToAssign: "MEMBER",
  },
  {
    id: "invitation-salman",
    createdAt: "2026-10-24T11:30:00.000Z",
    expiresAt: "2026-11-07T11:30:00.000Z",
    status: "ACTIVE",
    createdByDisplayName: "Salman",
    roleToAssign: "ADMIN",
  },
] satisfies HouseholdInvitationSummary[]

function invitationDate(value: string | null) {
  if (!value) return "No expiry date"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
        date,
      )
}

function PreviewControls({
  theme,
  setTheme,
  screen,
  state,
  setState,
  role,
  setRole,
  formMode,
  setFormMode,
}: {
  theme: PreviewTheme
  setTheme: (theme: PreviewTheme) => void
  screen: SecondaryScreen
  state: ManageState
  setState: (state: ManageState) => void
  role: PreviewRole
  setRole: (role: PreviewRole) => void
  formMode: ChoreFormMode
  setFormMode: (mode: ChoreFormMode) => void
}) {
  return (
    <aside aria-label="Proposed screen preview controls" className={styles.controls}>
      <div className={styles.themeControl}>
        {(["dark", "light"] as const).map((value) => (
          <button
            aria-pressed={theme === value}
            key={value}
            onClick={() => setTheme(value)}
            type="button"
          >
            {value === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
      {screen === "manage-chores" && (
        <label>
          <span>List state</span>
          <select onChange={(event) => setState(event.target.value as ManageState)} value={state}>
            <option value="loaded">Loaded</option>
            <option value="empty">Empty</option>
            <option value="loading">Loading</option>
            <option value="error">Error</option>
          </select>
        </label>
      )}
      {screen === "household-settings" && (
        <label>
          <span>Role preview</span>
          <select onChange={(event) => setRole(event.target.value as PreviewRole)} value={role}>
            <option value="OWNER">Owner</option>
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
          </select>
        </label>
      )}
      {screen === "chore-form" && (
        <label>
          <span>Form mode</span>
          <select
            onChange={(event) => setFormMode(event.target.value as ChoreFormMode)}
            value={formMode}
          >
            <option value="create">Create</option>
            <option value="edit">Edit</option>
          </select>
        </label>
      )}
    </aside>
  )
}

function Header({
  eyebrow,
  title,
  household,
  onBack,
  action,
}: {
  eyebrow: string
  title: string
  household: string
  onBack: () => void
  action?: ReactNode
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLine}>
        <button
          aria-label="Back to Household"
          className={styles.backButton}
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={19} />
        </button>
        <div className={styles.identity}>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <span>{household}</span>
        </div>
        {action && <div className={styles.headerAction}>{action}</div>}
      </div>
    </header>
  )
}

function SectionHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div className={styles.sectionHeading}>
      <p>{eyebrow}</p>
      <div>
        <h2>{title}</h2>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  )
}

export function HouseholdLiveDesignSectionHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return <SectionHeading detail={detail} eyebrow={eyebrow} title={title} />
}

function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string
  description: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="preview-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <button
          aria-label="Close dialog"
          className={styles.closeButton}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
        <p className={styles.dialogEyebrow}>Preview only · no household changes</p>
        <h2 id="preview-dialog-title">{title}</h2>
        <p className={styles.dialogDescription}>{description}</p>
        {children}
      </section>
    </div>
  )
}

function ManageChoresPreview({
  onBack,
  listState,
  setListState,
}: {
  onBack: () => void
  listState: ManageState
  setListState: (state: ManageState) => void
}) {
  const [menuChore, setMenuChore] = useState<string | null>(null)
  const [archiveTitle, setArchiveTitle] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [isActive, setIsActive] = useState<Record<string, boolean>>(
    Object.fromEntries(chores.map((chore) => [chore.title, chore.active])),
  )
  const listedChores = listState === "loaded" ? chores : []

  return (
    <>
      <Header
        action={
          <button
            className={styles.primaryButton}
            onClick={() => setMessage("Create Chore preview")}
            type="button"
          >
            <Plus aria-hidden="true" size={17} /> Create chore
          </button>
        }
        eyebrow="Household · Admin tools"
        household="1501"
        onBack={onBack}
        title="Manage chores"
      />
      <main className={styles.content}>
        <section className={styles.heroCard}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>A rhythm that works</p>
            <h2>
              Make room for
              <br />a smoother week.
            </h2>
            <p>Keep routines clear, shared, and easy to adjust.</p>
          </div>
          <div aria-hidden="true" className={styles.heroOrb}>
            <Repeat2 size={30} />
          </div>
        </section>
        <div className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>ACTIVE</span>
            <strong>2</strong>
            <small>Household routines</small>
          </article>
          <article className={styles.summaryCard}>
            <span>PAUSED</span>
            <strong>1</strong>
            <small>Ready when you are</small>
          </article>
          <article className={styles.summaryCard}>
            <span>HOUSEHOLD</span>
            <strong>3</strong>
            <small>People in the rotation</small>
          </article>
        </div>
        <SectionHeading detail="3 routines" eyebrow="The shared rhythm" title="Household chores" />
        {message && (
          <p className={styles.statusBanner} role="status">
            {message}
          </p>
        )}
        {listState === "loading" && (
          <div aria-label="Loading chores" className={styles.choreList}>
            {[0, 1, 2].map((item) => (
              <div className={`${styles.card} ${styles.skeleton}`} key={item} />
            ))}
          </div>
        )}
        {listState === "error" && (
          <div className={styles.emptyCard}>
            <p className={styles.eyebrow}>A momentary pause</p>
            <h3>Chores didn’t load.</h3>
            <p>Your household data is unchanged. Try the connection again.</p>
            <button
              className={styles.secondaryButton}
              onClick={() => setListState("loaded")}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {listState === "empty" && (
          <div className={styles.emptyCard}>
            <span aria-hidden="true" className={styles.emptyGlyph}>
              <Sparkles size={24} />
            </span>
            <p className={styles.eyebrow}>A fresh start</p>
            <h3>No shared chores yet.</h3>
            <p>Create a routine and decide together how it should rotate.</p>
            <button
              className={styles.primaryButton}
              onClick={() => setMessage("Create Chore preview")}
              type="button"
            >
              <Plus size={16} /> Create your first chore
            </button>
          </div>
        )}
        {listedChores.length > 0 && (
          <div className={styles.choreList}>
            {listedChores.map((chore) => (
              <article className={styles.choreCard} key={chore.title}>
                <div className={styles.choreIcon}>{chore.icon}</div>
                <div className={styles.choreInfo}>
                  <div className={styles.choreTitleLine}>
                    <h3>{chore.title}</h3>
                    <span
                      className={`${styles.statusPill} ${isActive[chore.title] ? styles.activePill : styles.pausedPill}`}
                    >
                      {isActive[chore.title] ? "Active" : "Paused"}
                    </span>
                  </div>
                  <p className={styles.metaLine}>
                    {chore.category} <span>·</span> {chore.schedule}
                  </p>
                  <p className={styles.metaLine}>
                    {chore.assignment} <span>·</span> {chore.effort}
                  </p>
                </div>
                <button
                  aria-expanded={menuChore === chore.title}
                  aria-label={`Actions for ${chore.title}`}
                  className={styles.moreButton}
                  onClick={() => setMenuChore(menuChore === chore.title ? null : chore.title)}
                  type="button"
                >
                  <Ellipsis size={20} />
                </button>
                {menuChore === chore.title && (
                  <div className={styles.actionMenu}>
                    <button
                      onClick={() => {
                        setMessage(`Edit preview · ${chore.title}`)
                        setMenuChore(null)
                      }}
                      type="button"
                    >
                      Edit details
                    </button>
                    <button
                      onClick={() => {
                        setIsActive((current) => ({
                          ...current,
                          [chore.title]: !current[chore.title],
                        }))
                        setMenuChore(null)
                      }}
                      type="button"
                    >
                      {isActive[chore.title] ? "Pause routine" : "Activate routine"}
                    </button>
                    <button
                      className={styles.menuDanger}
                      onClick={() => {
                        setArchiveTitle(chore.title)
                        setMenuChore(null)
                      }}
                      type="button"
                    >
                      Archive chore
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <p className={styles.previewNote}>
          <ShieldCheck aria-hidden="true" size={16} /> Preview data only. Real chore actions will
          remain connected to the existing household APIs.
        </p>
      </main>
      {archiveTitle && (
        <Dialog
          description={`“${archiveTitle}” will leave the active list. Its history will be preserved and remain available for reference.`}
          onClose={() => setArchiveTitle(null)}
          title={`Archive ${archiveTitle}?`}
        >
          <div className={styles.dialogActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setArchiveTitle(null)}
              type="button"
            >
              Keep chore
            </button>
            <button
              className={styles.dangerButton}
              onClick={() => {
                setMessage(`${archiveTitle} archive preview`)
                setArchiveTitle(null)
              }}
              type="button"
            >
              Archive chore
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}

function HouseholdSettingsPreview({
  onBack,
  role,
  setRole,
}: {
  onBack: () => void
  role: PreviewRole
  setRole: (role: PreviewRole) => void
}) {
  const [deleteStage, setDeleteStage] = useState<0 | 1 | 2 | 3>(0)
  const [consents, setConsents] = useState([false, false, false])
  const [typedName, setTypedName] = useState("")
  const [style, setStyle] = useState("NORMAL")
  const [message, setMessage] = useState("")
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const revokeTarget = invitations.find((invitation) => invitation.id === revokeId)
  const canEdit = role === "OWNER"
  const canManage = role !== "MEMBER"
  const deleteReady = consents.every(Boolean) && typedName === "1501"

  return (
    <>
      <Header
        eyebrow="Household · Your home"
        household="1501"
        onBack={onBack}
        title="Household settings"
      />
      <main className={styles.content}>
        <section className={styles.heroCard}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>A home, together</p>
            <h2>
              Make it feel
              <br />
              like yours.
            </h2>
            <p>The details and defaults that shape your shared space.</p>
          </div>
          <div aria-hidden="true" className={styles.heroOrb}>
            <House size={30} />
          </div>
        </section>
        {message && (
          <p className={styles.statusBanner} role="status">
            {message}
          </p>
        )}
        <section className={styles.settingsCard}>
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>Your household</p>
              <h2>1501</h2>
            </div>
            <span className={styles.rolePill}>{role}</span>
          </div>
          <label className={styles.fieldLabel}>
            Household name
            <input defaultValue="1501" disabled={!canEdit} />
          </label>
          <label className={styles.fieldLabel}>
            A little about this home <span>Optional</span>
            <textarea
              defaultValue="A calm, shared space for the people who make it home."
              disabled={!canEdit}
              rows={3}
            />
          </label>
          <div className={styles.detailGrid}>
            <div>
              <span>TIMEZONE</span>
              <strong>America/Argentina/Buenos_Aires</strong>
            </div>
            <div>
              <span>STARTED</span>
              <strong>October 2026</strong>
            </div>
          </div>
          {canEdit ? (
            <button
              className={styles.primaryButton}
              onClick={() => setMessage("Details saved · preview only")}
              type="button"
            >
              Save household details
            </button>
          ) : (
            <p className={styles.permissionNote}>
              Only the household owner can change these details.
            </p>
          )}
        </section>
        <section className={styles.settingsCard}>
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>A shared default</p>
              <h2>Notifications</h2>
            </div>
            <Bell aria-hidden="true" className={styles.headingIcon} size={20} />
          </div>
          <label className={styles.fieldLabel}>
            Household notification style
            <select
              disabled={!canManage}
              onChange={(event) => setStyle(event.target.value)}
              value={style}
            >
              <option value="NORMAL">Normal</option>
              <option value="FUNNY">Funny</option>
              <option value="MOTIVATIONAL">Motivational</option>
              <option value="COMPETITIVE">Competitive</option>
              <option value="MINIMAL">Minimal</option>
            </select>
          </label>
          <p className={styles.helperText}>
            This is the shared household default. Each member can choose a personal style in their
            own notification settings.
          </p>
          {canManage ? (
            <button
              className={styles.secondaryButton}
              onClick={() => setMessage("Notification style saved · preview only")}
              type="button"
            >
              Save default style
            </button>
          ) : (
            <p className={styles.permissionNote}>
              Only an owner or admin can change this household default.
            </p>
          )}
        </section>
        {canManage && (
          <section className={styles.settingsCard}>
            <div className={styles.cardHeading}>
              <div>
                <p className={styles.eyebrow}>Invitations</p>
                <h2>Who can join</h2>
              </div>
              <span className={styles.countPill}>{invitations.length} active</span>
            </div>
            {invitations.map((invitation) => (
              <article className={styles.invitationRow} key={invitation.id}>
                <span className={styles.inviteMark}>
                  <UsersRound size={17} />
                </span>
                <div className={styles.invitationDetails}>
                  <strong>
                    Created by {invitation.createdByDisplayName ?? "Household member"}
                  </strong>
                  <small>Created {invitationDate(invitation.createdAt)}</small>
                  <small>Expires {invitationDate(invitation.expiresAt)}</small>
                  <small>Role on join · {invitation.roleToAssign}</small>
                  <span className={styles.invitationStatus}>{invitation.status}</span>
                </div>
                <button
                  className={styles.textDanger}
                  onClick={() => setRevokeId(invitation.id)}
                  type="button"
                >
                  Revoke
                </button>
              </article>
            ))}
            <p className={styles.helperText}>
              Only active invitations appear here. Revoking one prevents anyone from using its code.
            </p>
          </section>
        )}
        <section className={styles.dangerZone}>
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.dangerEyebrow}>Irreversible</p>
              <h2>Delete household</h2>
            </div>
            <LockKeyhole aria-hidden="true" size={20} />
          </div>
          <p>
            Deleting removes this household and its data for everyone. If you only want to stop
            managing the home, transfer ownership instead.
          </p>
          {canEdit ? (
            <button
              className={styles.dangerOutline}
              onClick={() => setDeleteStage(1)}
              type="button"
            >
              Review deletion steps
            </button>
          ) : (
            <p className={styles.permissionNote}>
              Only the household owner can delete this household.
            </p>
          )}
        </section>
      </main>
      {revokeId && (
        <Dialog
          description="Revoking this invitation immediately disables it so nobody can use its code. This preview will not contact the server."
          onClose={() => setRevokeId(null)}
          title="Revoke invitation?"
        >
          <p className={styles.invitationTarget}>
            {revokeTarget
              ? `Created by ${revokeTarget.createdByDisplayName ?? "a household member"} · ${revokeTarget.roleToAssign} access · expires ${invitationDate(revokeTarget.expiresAt)}`
              : "This active invitation"}
          </p>
          <div className={styles.dialogActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setRevokeId(null)}
              type="button"
            >
              Keep invitation
            </button>
            <button
              className={styles.dangerButton}
              onClick={() => {
                setMessage("Invitation revoke preview")
                setRevokeId(null)
              }}
              type="button"
            >
              Revoke invite
            </button>
          </div>
        </Dialog>
      )}
      {deleteStage > 0 && (
        <Dialog
          description={
            deleteStage === 1
              ? "Deleting is permanent. Members will lose access, and household records and chore history cannot be recovered."
              : deleteStage === 2
                ? "Confirm each consequence before moving to identity verification."
                : "This is the final review. The live screen will preserve the existing password or Google reauthentication requirement."
          }
          onClose={() => {
            setDeleteStage(0)
            setConsents([false, false, false])
            setTypedName("")
          }}
          title={
            deleteStage === 1
              ? "Before you delete 1501"
              : deleteStage === 2
                ? "Confirm the consequences"
                : "Final deletion check"
          }
        >
          {deleteStage === 1 && (
            <div className={styles.dialogStack}>
              <p className={styles.consequence}>
                <UsersRound size={17} /> Everyone in this household will lose access.
              </p>
              <p className={styles.consequence}>
                <Clock3 size={17} /> Household chore data and history will be removed.
              </p>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setDeleteStage(0)
                  setMessage("Ownership transfer remains a separate Household flow.")
                }}
                type="button"
              >
                Transfer ownership instead
              </button>
              <div className={styles.dialogActions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setDeleteStage(0)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={styles.dangerButton}
                  onClick={() => setDeleteStage(2)}
                  type="button"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
          {deleteStage === 2 && (
            <div className={styles.dialogStack}>
              {[
                "All members will lose household access.",
                "Household records and chore history will be permanently deleted.",
                "I understand this action cannot be undone.",
              ].map((label, index) => (
                <label className={styles.consentRow} key={label}>
                  <input
                    checked={consents[index]}
                    onChange={(event) =>
                      setConsents((current) =>
                        current.map((value, item) =>
                          item === index ? event.target.checked : value,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  {label}
                </label>
              ))}
              <div className={styles.dialogActions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setDeleteStage(1)}
                  type="button"
                >
                  Back
                </button>
                <button
                  className={styles.dangerButton}
                  disabled={!consents.every(Boolean)}
                  onClick={() => setDeleteStage(3)}
                  type="button"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
          {deleteStage === 3 && (
            <div className={styles.dialogStack}>
              <label className={styles.fieldLabel}>
                Type the household name exactly
                <input
                  onChange={(event) => setTypedName(event.target.value)}
                  placeholder="1501"
                  value={typedName}
                />
              </label>
              <label className={styles.fieldLabel}>
                Password / recent verification
                <input
                  autoComplete="off"
                  placeholder="Preview only · no credential collected"
                  type="password"
                />
              </label>
              <p className={styles.helperText}>
                The real screen requires the existing password or recent Google reauthentication. No
                credentials are submitted in this preview.
              </p>
              <div className={styles.dialogActions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setDeleteStage(2)}
                  type="button"
                >
                  Back
                </button>
                <button
                  className={styles.dangerButton}
                  disabled={!deleteReady}
                  onClick={() => {
                    setDeleteStage(0)
                    setConsents([false, false, false])
                    setTypedName("")
                    setMessage("Final deletion preview · no API request sent")
                  }}
                  type="button"
                >
                  Permanently delete
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
      <div className={styles.roleTools} aria-label="Role preview">
        {(["OWNER", "ADMIN", "MEMBER"] as const).map((item) => (
          <button
            aria-pressed={role === item}
            key={item}
            onClick={() => setRole(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
    </>
  )
}

function ChoreFormPreview({ mode, onBack }: { mode: ChoreFormMode; onBack: () => void }) {
  const [strategy, setStrategy] = useState("ROUND_ROBIN")
  const [frequency, setFrequency] = useState("WEEKLY")
  const [discardOpen, setDiscardOpen] = useState(false)
  const [message, setMessage] = useState("")

  return (
    <>
      <Header
        eyebrow={mode === "create" ? "Household · New routine" : "Household · Edit routine"}
        household="1501"
        onBack={() => setDiscardOpen(true)}
        title={mode === "create" ? "Create a chore" : "Edit a chore"}
      />
      <main className={styles.content}>
        <section className={styles.heroCard}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              {mode === "create" ? "A small thing, shared" : "Keep the rhythm in sync"}
            </p>
            <h2>
              {mode === "create" ? "Build a routine" : "Shape the routine"}
              <br />
              {mode === "create" ? "that feels fair." : "to fit your home."}
            </h2>
            <p>
              {mode === "create"
                ? "Choose the details now. You can adjust them as your home changes."
                : "Update the details together. Changes will apply to future turns."}
            </p>
          </div>
          <div aria-hidden="true" className={styles.heroOrb}>
            <Sparkles size={29} />
          </div>
        </section>
        {message && (
          <p className={styles.statusBanner} role="status">
            {message}
          </p>
        )}
        <div className={styles.formLayout}>
          <section className={styles.settingsCard}>
            <SectionHeading eyebrow="01 · The details" title="Name the routine" />
            <label className={styles.fieldLabel}>
              Category
              <select defaultValue="Kitchen">
                <option>Kitchen</option>
                <option>Cleaning</option>
                <option>Garden</option>
                <option>Household</option>
              </select>
            </label>
            <div className={styles.emojiField}>
              <span className={styles.iconPreview}>K</span>
              <div>
                <strong>Kitchen icon</strong>
                <small>Matched to the selected category</small>
              </div>
              <button className={styles.textButton} type="button">
                Change
              </button>
            </div>
            <label className={styles.fieldLabel}>
              Chore name
              <input defaultValue="Reset the kitchen" />
            </label>
            <label className={styles.fieldLabel}>
              Description <span>Optional</span>
              <textarea
                defaultValue="Wipe the counters, clear the table, and leave the sink ready for morning."
                rows={3}
              />
            </label>
          </section>
          <section className={styles.settingsCard}>
            <SectionHeading eyebrow="02 · A fair turn" title="Who takes this on?" />
            <div className={styles.choiceGrid}>
              {[
                ["FIXED", "One person", "Keep it with a chosen person"],
                ["ROUND_ROBIN", "Take turns", "Rotate fairly through the group"],
                ["RANDOM", "Mix it up", "Choose from the selected people"],
              ].map(([value, title, detail]) => (
                <button
                  aria-pressed={strategy === value}
                  className={styles.choiceCard}
                  key={value}
                  onClick={() => setStrategy(value)}
                  type="button"
                >
                  <span className={styles.radioDot} />
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
            {strategy === "FIXED" && (
              <label className={styles.fieldLabel}>
                Assigned to
                <select defaultValue="Salman">
                  {people.map((person) => (
                    <option key={person}>{person}</option>
                  ))}
                </select>
              </label>
            )}
            {strategy !== "FIXED" && (
              <div className={styles.peopleChooser}>
                <div className={styles.cardHeading}>
                  <strong>Eligible people</strong>
                  <span>3 selected</span>
                </div>
                {people.map((person, index) => (
                  <label className={styles.personChoice} key={person}>
                    <input defaultChecked type="checkbox" />
                    <span className={styles.personAvatar}>{person[0]}</span>
                    <span>{person}</span>
                    <small>{index === 2 ? "You" : "Member"}</small>
                  </label>
                ))}
                <label className={styles.fieldLabel}>
                  People needed
                  <input defaultValue="1" max="3" min="1" type="number" />
                </label>
              </div>
            )}
          </section>
          <section className={styles.settingsCard}>
            <SectionHeading eyebrow="03 · The rhythm" title="When should it happen?" />
            <label className={styles.fieldLabel}>
              Repeat
              <select onChange={(event) => setFrequency(event.target.value)} value={frequency}>
                <option value="ONCE">One time</option>
                <option value="DAILY">Every day</option>
                <option value="WEEKLY">Every week</option>
                <option value="CUSTOM">Every few weeks</option>
              </select>
            </label>
            {(frequency === "WEEKLY" || frequency === "CUSTOM") && (
              <div className={styles.weekdayPicker}>
                <span>On these days</span>
                <div>
                  {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                    <button
                      aria-pressed={index === 0 || index === 3}
                      key={`${day}-${index}`}
                      type="button"
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {frequency === "CUSTOM" && (
              <label className={styles.fieldLabel}>
                Repeat every
                <input defaultValue="2" min="2" max="52" type="number" />
              </label>
            )}
            <div className={styles.twoFields}>
              <label className={styles.fieldLabel}>
                Starts
                <input defaultValue="2026-11-02" type="date" />
              </label>
              <label className={styles.fieldLabel}>
                Due time
                <input defaultValue="19:00" type="time" />
              </label>
            </div>
            {frequency !== "ONCE" && (
              <label className={styles.toggleRow}>
                <span>
                  <strong>Set an end date</strong>
                  <small>Keep this routine open-ended.</small>
                </span>
                <input type="checkbox" />
              </label>
            )}
          </section>
          <section className={styles.settingsCard}>
            <SectionHeading eyebrow="04 · The effort" title="Set a helpful baseline" />
            <label className={styles.fieldLabel}>
              Effort level <span>3 of 5 · Moderate</span>
              <input
                aria-label="Effort level"
                className={styles.range}
                defaultValue="3"
                max="5"
                min="1"
                type="range"
              />
            </label>
            <label className={styles.fieldLabel}>
              Estimated time <span>Optional</span>
              <div className={styles.inputWithSuffix}>
                <input defaultValue="20" inputMode="numeric" />
                <span>minutes</span>
              </div>
            </label>
            <label className={styles.fieldLabel}>
              Priority
              <select defaultValue="NORMAL">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <label className={styles.toggleRow}>
              <span>
                <strong>Needs a quick check</strong>
                <small>A household member verifies the chore is done.</small>
              </span>
              <input type="checkbox" />
            </label>
          </section>
        </div>
        <footer className={styles.formFooter}>
          <p>
            <ShieldCheck size={16} /> Changes save to this household’s shared chore list.
          </p>
          <div>
            <button
              className={styles.secondaryButton}
              onClick={() => setDiscardOpen(true)}
              type="button"
            >
              Cancel
            </button>
            <button
              className={styles.primaryButton}
              onClick={() =>
                setMessage(
                  mode === "create"
                    ? "Save preview · no chore was created"
                    : "Save preview · no chore was changed",
                )
              }
              type="button"
            >
              <Check size={16} /> {mode === "create" ? "Save chore" : "Save changes"}
            </button>
          </div>
        </footer>
      </main>
      {discardOpen && (
        <Dialog
          description="You have unsaved changes. Leave this form and discard them?"
          onClose={() => setDiscardOpen(false)}
          title="Leave without saving?"
        >
          <div className={styles.dialogActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setDiscardOpen(false)}
              type="button"
            >
              Keep editing
            </button>
            <button
              className={styles.dangerButton}
              onClick={() => {
                setDiscardOpen(false)
                onBack()
              }}
              type="button"
            >
              Discard changes
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}

export function HouseholdSecondaryDesignPreview({ screen }: { screen: SecondaryScreen }) {
  const [theme, setTheme] = useState<PreviewTheme>("dark")
  const [message, setMessage] = useState("")
  const [role, setRole] = useState<PreviewRole>("OWNER")
  const [listState, setListState] = useState<ManageState>("loaded")
  const [formMode, setFormMode] = useState<ChoreFormMode>("create")

  return (
    <div
      className={`${styles.root} ${theme === "light" ? styles.light : styles.dark}`}
      data-preview-screen={screen}
    >
      <PreviewControls
        role={role}
        formMode={formMode}
        screen={screen}
        setRole={setRole}
        setState={setListState}
        setFormMode={setFormMode}
        setTheme={setTheme}
        state={listState}
        theme={theme}
      />
      <div className={styles.proposedBanner}>
        <Sparkles aria-hidden="true" size={14} /> PROPOSED EXTENSION <span>·</span> NOT LOCKED IN
        FIGMA
      </div>
      {screen === "manage-chores" && (
        <ManageChoresPreview
          listState={listState}
          onBack={() => setMessage("Back to Household · preview only")}
          setListState={setListState}
        />
      )}
      {screen === "household-settings" && (
        <HouseholdSettingsPreview
          onBack={() => setMessage("Back to Household · preview only")}
          role={role}
          setRole={setRole}
        />
      )}
      {screen === "chore-form" && (
        <ChoreFormPreview
          mode={formMode}
          onBack={() => setMessage("Back to Manage Chores · preview only")}
        />
      )}
      {message && (
        <div className={styles.toast} role="status">
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage("")} type="button">
            <X size={15} />
          </button>
        </div>
      )}
      <div className={styles.bottomBar}>
        <span>
          <House aria-hidden="true" size={16} /> Household{" "}
          <ArrowRight aria-hidden="true" size={14} />{" "}
          {screen === "manage-chores"
            ? "Manage chores"
            : screen === "household-settings"
              ? "Settings"
              : formMode === "create"
                ? "Create chore"
                : "Edit chore"}
        </span>
        <span>Preview data only</span>
      </div>
    </div>
  )
}
