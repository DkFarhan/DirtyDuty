"use client"

import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import type { HouseholdMemberDTO } from "@/lib/household/api"
import { getMemberActionCopy, getMemberActionOptions, type MemberAction } from "../member-card"
import glassStyles from "../bottom-nav.module.css"
import styles from "./household-screen-view.module.css"

export type HouseholdVisualTheme = "dark" | "light"
export type HouseholdNavigationDestination = "dashboard" | "my-chores" | "household" | "profile"
export type HouseholdViewStatus = "loading" | "loaded" | "error"
export type HouseholdLeaveFlow = "closed" | "member-confirm" | "owner-select" | "owner-confirm"

export interface HouseholdMemberViewModel extends HouseholdMemberDTO {
  isCurrentUser: boolean
  joinedLabel: string
  progressPercent: number
}

export interface HouseholdScreenViewModel {
  householdName: string
  currentUserRole: string
  currentUserId: string
  canManage: boolean
  status: HouseholdViewStatus
  errorMessage?: string
  refreshError?: string
  members: HouseholdMemberViewModel[]
}

export interface HouseholdScreenViewProps {
  theme: HouseholdVisualTheme
  phonePreview?: boolean
  viewModel: HouseholdScreenViewModel
  activeDestination: HouseholdNavigationDestination
  openMemberMenuId: string | null
  pendingMemberAction: { action: MemberAction; member: HouseholdMemberDTO } | null
  confirmText: string
  memberActionError: string | null
  busyMemberId: string | null
  leaveFlow: HouseholdLeaveFlow
  selectedNewOwnerId: string
  leaveError: string | null
  leaveBusy: boolean
  onNavigate: (destination: HouseholdNavigationDestination) => void
  onOpenInvite: () => void
  onManageChores: () => void
  onHouseholdSettings: () => void
  onRetry: () => void
  onToggleMemberMenu: (memberId: string) => void
  onMemberAction: (action: MemberAction, member: HouseholdMemberDTO) => void
  onOpenLeave: () => void
  onCloseLeave: () => void
  onBackToSuccessorSelection: () => void
  onSelectSuccessor: (memberId: string) => void
  onContinueOwnerLeave: () => void
  onConfirmLeave: () => void
  onCloseMemberAction: () => void
  onChangeConfirmText: (value: string) => void
  onConfirmMemberAction: () => void
  previewInvite?: {
    status: "ready" | "loading" | "error" | "created"
    code?: string
    expiresAt?: string
    errorMessage?: string
  } | null
  onGeneratePreviewInvite?: () => void
  onClosePreviewInvite?: () => void
}

const navigationItems: Array<{
  id: HouseholdNavigationDestination
  label: string
}> = [
  { id: "dashboard", label: "Home" },
  { id: "my-chores", label: "My Chores" },
  { id: "household", label: "Household" },
  { id: "profile", label: "Profile" },
]

const avatarSlotFor = (index: number) => (index % 3) + 1

function roleTitle(role: string) {
  return role
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function actionRole(role: string): "OWNER" | "ADMIN" | "MEMBER" {
  if (role === "OWNER" || role === "ADMIN") return role
  return "MEMBER"
}

function MemberMenu({
  member,
  currentUserRole,
  onAction,
  onClose,
}: {
  member: HouseholdMemberViewModel
  currentUserRole: string
  onAction: (action: MemberAction, member: HouseholdMemberDTO) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const actions = getMemberActionOptions({
    member,
    currentUserRole: actionRole(currentUserRole),
    isCurrentUser: member.isCurrentUser,
  })

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }

    window.addEventListener("mousedown", handlePointerDown)
    return () => window.removeEventListener("mousedown", handlePointerDown)
  }, [onClose])

  if (actions.length === 0) return null

  return (
    <div className={styles.actionMenu} ref={menuRef}>
      <button
        aria-expanded="true"
        aria-label={`Close actions for ${member.displayName}`}
        className={styles.memberMenuButton}
        onClick={onClose}
        type="button"
      >
        <span aria-hidden="true" className={styles.memberMenuGlyph} />
      </button>
      <div aria-label={`Actions for ${member.displayName}`} className={styles.actionMenuPanel}>
        {actions.map((item) => (
          <button
            className={item.action === "remove" ? styles.removeMenuItem : styles.menuItem}
            key={item.action}
            onClick={() => onAction(item.action, member)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  index,
  viewModel,
  theme,
  openMemberMenuId,
  onToggleMemberMenu,
  onMemberAction,
}: {
  member: HouseholdMemberViewModel
  index: number
  viewModel: HouseholdScreenViewModel
  theme: HouseholdVisualTheme
  openMemberMenuId: string | null
  onToggleMemberMenu: (memberId: string) => void
  onMemberAction: (action: MemberAction, member: HouseholdMemberDTO) => void
}) {
  const slot = avatarSlotFor(index)
  const hasActions =
    getMemberActionOptions({
      member,
      currentUserRole: actionRole(viewModel.currentUserRole),
      isCurrentUser: member.isCurrentUser,
    }).length > 0

  return (
    <article
      className={`${styles.memberRow} ${member.isCurrentUser ? styles.currentMember : ""}`}
      data-current-user={member.isCurrentUser ? "true" : "false"}
      data-member-id={member.userId}
      data-tone={slot}
    >
      <div aria-hidden="true" className={styles.avatarHalo} data-slot={slot} data-theme={theme} />
      <span className={styles.avatarDisc} data-slot={slot} data-theme={theme}>
        {member.displayName.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
      <div className={styles.memberIdentity}>
        <div className={styles.memberNameLine}>
          <h3 className={styles.memberName}>{member.displayName}</h3>
          <span className={styles.roleChip} data-role={member.role}>
            {roleTitle(member.role)}
          </span>
          {member.isCurrentUser && <span className={styles.youChip}>You</span>}
        </div>
        <p className={styles.joinedLabel}>{member.joinedLabel}</p>
      </div>
      <div className={styles.memberMetric}>
        <p className={styles.memberCount}>
          {member.completedThisWeek} / {member.assignedThisWeek}
        </p>
        <p className={styles.memberPercent}>{member.progressPercent}% this week</p>
      </div>
      {hasActions && (
        <div className={styles.memberActionSlot}>
          {openMemberMenuId === member.userId ? (
            <MemberMenu
              currentUserRole={viewModel.currentUserRole}
              member={member}
              onAction={onMemberAction}
              onClose={() => onToggleMemberMenu(member.userId)}
            />
          ) : (
            <button
              aria-expanded="false"
              aria-label={`Actions for ${member.displayName}`}
              className={styles.memberMenuButton}
              onClick={() => onToggleMemberMenu(member.userId)}
              type="button"
            >
              <span aria-hidden="true" className={styles.memberMenuGlyph} />
            </button>
          )}
        </div>
      )}
      <div
        aria-label={`${member.progressPercent}% of assigned chores completed this week`}
        className={styles.progressRail}
        role="progressbar"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={member.progressPercent}
      >
        <span className={styles.progressFill} style={{ width: `${member.progressPercent}%` }} />
      </div>
    </article>
  )
}

function Navigation({
  activeDestination,
  theme,
  onNavigate,
}: Pick<HouseholdScreenViewProps, "activeDestination" | "theme" | "onNavigate">) {
  return (
    <nav aria-label="Primary navigation" className={styles.navigation}>
      <div className={`${styles.navigationCapsule} ${glassStyles.capsule}`}>
        <span
          aria-hidden="true"
          className={styles.activeIsland}
          data-active-destination={activeDestination}
        />
        <div className={styles.navigationItems}>
          {navigationItems.map((item) => {
            const active = activeDestination === item.id
            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={`${styles.navigationItem} ${active ? styles.activeNavigationItem : ""}`}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={styles.navigationIcon}
                  data-destination={item.id}
                  data-theme={theme}
                />
                <span className={styles.navigationLabel}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

function MemberActionSheet({
  memberAction,
  confirmText,
  error,
  busy,
  householdName,
  onCancel,
  onChangeConfirmText,
  onConfirm,
}: {
  memberAction: HouseholdScreenViewProps["pendingMemberAction"]
  confirmText: string
  error: string | null
  busy: boolean
  householdName: string
  onCancel: () => void
  onChangeConfirmText: (value: string) => void
  onConfirm: () => void
}) {
  if (!memberAction) return null
  const copy = getMemberActionCopy(memberAction.action, memberAction.member, householdName)
  if (!copy) return null
  const isTransfer = memberAction.action === "transfer"

  return (
    <div className={styles.dialogBackdrop}>
      <section
        aria-labelledby="household-member-action-title"
        aria-modal="true"
        className={styles.dialogSheet}
        role="dialog"
      >
        <span aria-hidden="true" className={styles.sheetHandle} />
        <button
          aria-label="Close member action"
          className={styles.sheetClose}
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <p className={styles.sheetEyebrow}>Household access</p>
        <h2 className={styles.sheetTitle} id="household-member-action-title">
          {copy.title}
        </h2>
        <p className={styles.sheetDescription}>{copy.description}</p>
        {isTransfer && (
          <label className={styles.confirmLabel}>
            Type “{householdName}” or “{memberAction.member.displayName}” to confirm
            <input
              autoFocus
              className={styles.confirmInput}
              onChange={(event) => onChangeConfirmText(event.currentTarget.value)}
              placeholder={householdName}
              type="text"
              value={confirmText}
            />
          </label>
        )}
        {error && (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogButtons}>
          <button className={styles.secondaryButton} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={
              memberAction.action === "remove" ? styles.dangerButton : styles.primaryButton
            }
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Working…" : "Confirm"}
          </button>
        </div>
      </section>
    </div>
  )
}

function LeaveSheet({ props }: { props: HouseholdScreenViewProps }) {
  const { viewModel } = props
  if (props.leaveFlow === "closed") return null

  const eligibleMembers = viewModel.members.filter(
    (member) => !member.isCurrentUser && (member.role === "MEMBER" || member.role === "ADMIN"),
  )
  const selectedSuccessor = eligibleMembers.find(
    (member) => member.userId === props.selectedNewOwnerId,
  )

  return (
    <div className={styles.dialogBackdrop}>
      <section
        aria-labelledby="household-leave-title"
        aria-modal="true"
        className={`${styles.dialogSheet} ${
          props.leaveFlow === "owner-select" &&
          viewModel.status === "loaded" &&
          eligibleMembers.length > 0
            ? styles.ownerSelectionSheet
            : ""
        }`}
        role="dialog"
      >
        <span aria-hidden="true" className={styles.sheetHandle} />
        <button
          aria-label="Close leave household"
          className={styles.sheetClose}
          disabled={props.leaveBusy}
          onClick={props.onCloseLeave}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
        {props.leaveFlow === "member-confirm" && (
          <>
            <p className={styles.sheetEyebrow}>Leave household</p>
            <h2 className={styles.sheetTitle} id="household-leave-title">
              Leave {viewModel.householdName}?
            </h2>
            <p className={styles.sheetDescription}>
              Your active membership ends. You can rejoin with a new invitation. Past household
              activity remains.
            </p>
            {props.leaveError && (
              <p className={styles.dialogError} role="alert">
                {props.leaveError}
              </p>
            )}
            <div className={styles.dialogButtons}>
              <button className={styles.secondaryButton} onClick={props.onCloseLeave} type="button">
                Cancel
              </button>
              <button
                className={styles.dangerButton}
                disabled={props.leaveBusy}
                onClick={props.onConfirmLeave}
                type="button"
              >
                {props.leaveBusy ? "Leaving…" : "Leave household"}
              </button>
            </div>
          </>
        )}
        {props.leaveFlow === "owner-select" && viewModel.status === "loading" && (
          <>
            <p className={styles.sheetEyebrow}>Ownership</p>
            <h2 className={styles.sheetTitle} id="household-leave-title">
              Checking household members
            </h2>
            <p className={styles.sheetDescription}>
              Loading active members who can take ownership…
            </p>
            <button
              className={styles.secondaryFullButton}
              onClick={props.onCloseLeave}
              type="button"
            >
              Cancel
            </button>
          </>
        )}
        {props.leaveFlow === "owner-select" && viewModel.status === "error" && (
          <>
            <p className={styles.sheetEyebrow}>Ownership</p>
            <h2 className={styles.sheetTitle} id="household-leave-title">
              Unable to load household members
            </h2>
            <p className={styles.dialogError} role="alert">
              {viewModel.errorMessage}
            </p>
            <div className={styles.dialogButtons}>
              <button className={styles.secondaryButton} onClick={props.onCloseLeave} type="button">
                Cancel
              </button>
              <button className={styles.primaryButton} onClick={props.onRetry} type="button">
                Try again
              </button>
            </div>
          </>
        )}
        {props.leaveFlow === "owner-select" &&
          viewModel.status === "loaded" &&
          eligibleMembers.length > 0 && (
            <>
              <p className={styles.sheetEyebrow}>Owner · required step</p>
              <h2 className={styles.sheetTitle} id="household-leave-title">
                Pass the keys.
              </h2>
              <p className={styles.sheetDescription}>
                Choose another active member to take ownership. You will leave{" "}
                {viewModel.householdName} in the next step.
              </p>
              <p className={styles.successorLabel}>New owner</p>
              <div className={styles.successorList}>
                {eligibleMembers.map((member) => (
                  <label className={styles.successorOption} key={member.userId}>
                    <input
                      checked={props.selectedNewOwnerId === member.userId}
                      name="new-household-owner"
                      onChange={() => props.onSelectSuccessor(member.userId)}
                      type="radio"
                      value={member.userId}
                    />
                    <span className={styles.successorDetails}>
                      <span className={styles.successorName}>{member.displayName}</span>
                      <span className={styles.successorRole}>{roleTitle(member.role)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className={styles.successorHint}>Choose who takes care of this household next.</p>
              {props.leaveError && (
                <p className={styles.dialogError} role="alert">
                  {props.leaveError}
                </p>
              )}
              <div className={styles.dialogButtons}>
                <button
                  className={styles.secondaryButton}
                  onClick={props.onCloseLeave}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={!props.selectedNewOwnerId || props.leaveBusy}
                  onClick={props.onContinueOwnerLeave}
                  type="button"
                >
                  Continue
                </button>
              </div>
            </>
          )}
        {props.leaveFlow === "owner-select" &&
          viewModel.status === "loaded" &&
          eligibleMembers.length === 0 && (
            <>
              <p className={styles.sheetEyebrow}>Ownership</p>
              <h2 className={styles.sheetTitle} id="household-leave-title">
                You’re the only active member
              </h2>
              <p className={styles.sheetDescription}>
                Invite someone to join before leaving, or manage this household in settings.
              </p>
              <div className={styles.dialogStack}>
                <button
                  className={styles.primaryButton}
                  onClick={() => {
                    props.onCloseLeave()
                    props.onOpenInvite()
                  }}
                  type="button"
                >
                  Invite member
                </button>
                <button
                  className={styles.secondaryFullButton}
                  onClick={() => {
                    props.onCloseLeave()
                    props.onHouseholdSettings()
                  }}
                  type="button"
                >
                  Household settings
                </button>
                <button className={styles.textButton} onClick={props.onCloseLeave} type="button">
                  Cancel
                </button>
              </div>
            </>
          )}
        {props.leaveFlow === "owner-confirm" && (
          <>
            <p className={styles.sheetEyebrow}>Confirm ownership change</p>
            <h2 className={styles.sheetTitle} id="household-leave-title">
              Transfer ownership to {selectedSuccessor?.displayName} and leave?
            </h2>
            <p className={styles.sheetDescription}>
              {selectedSuccessor?.displayName} becomes Owner. You leave the household in the same
              action.
            </p>
            {props.leaveError && (
              <p className={styles.dialogError} role="alert">
                {props.leaveError}
              </p>
            )}
            <div className={styles.dialogButtons}>
              <button
                className={styles.secondaryButton}
                disabled={props.leaveBusy}
                onClick={props.onBackToSuccessorSelection}
                type="button"
              >
                Back
              </button>
              <button
                className={styles.dangerButton}
                disabled={props.leaveBusy || !selectedSuccessor}
                onClick={props.onConfirmLeave}
                type="button"
              >
                {props.leaveBusy ? "Leaving…" : "Transfer and leave"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function PreviewInviteSheet({
  invite,
  onGenerate,
  onClose,
}: {
  invite: NonNullable<HouseholdScreenViewProps["previewInvite"]>
  onGenerate: () => void
  onClose: () => void
}) {
  return (
    <div className={styles.dialogBackdrop}>
      <section
        aria-labelledby="preview-invite-title"
        aria-modal="true"
        className={`${styles.dialogSheet} ${styles.inviteDialogSheet}`}
        role="dialog"
      >
        <span aria-hidden="true" className={styles.sheetHandle} />
        <button
          aria-label="Close invitation dialog"
          className={styles.sheetClose}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <p className={styles.sheetEyebrow}>Household invitation</p>
        <h2 className={styles.sheetTitle} id="preview-invite-title">
          Invite a housemate.
        </h2>
        <p className={styles.inviteDescription}>
          Generate a secure, one-time code for someone joining 1501.
        </p>
        {invite.status === "created" && invite.code ? (
          <div className={styles.inviteDialogContent}>
            <div className={styles.inviteCodePanel}>
              <code>{invite.code}</code>
            </div>
            <p className={styles.inviteExpiry}>
              Preview code · Expires {invite.expiresAt ?? "soon"}
            </p>
            <div className={styles.dialogButtons}>
              <button className={styles.primaryButton} onClick={onClose} type="button">
                Done
              </button>
            </div>
          </div>
        ) : invite.status === "error" ? (
          <div className={styles.inviteDialogContent}>
            <p className={styles.inviteErrorNotice} role="alert">
              <strong>Invite couldn’t be created</strong>
              {invite.errorMessage ?? "No code was generated. Try again."}
            </p>
            <button
              className={`${styles.primaryButton} ${styles.invitePrimaryButton}`}
              onClick={onGenerate}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className={styles.inviteDialogContent}>
            {invite.status === "loading" && (
              <p className={styles.sheetDescription} role="status">
                Generating a secure invitation…
              </p>
            )}
            <button
              className={`${styles.primaryButton} ${styles.invitePrimaryButton}`}
              disabled={invite.status === "loading"}
              onClick={onGenerate}
              type="button"
            >
              {invite.status === "loading" ? "Generating…" : "Generate code"}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

export function HouseholdScreenView(props: HouseholdScreenViewProps) {
  const { theme, phonePreview = false, viewModel } = props
  return (
    <div
      className={`${styles.screen} ${phonePreview ? styles.phonePreview : ""} ${
        theme === "light" ? styles.lightTheme : styles.darkTheme
      }`}
    >
      <main aria-label="Household" className={styles.scrollContent}>
        <div aria-hidden="true" className={styles.safeAreaSpacer} />
        <header className={styles.householdHeader}>
          <span aria-hidden="true" className={styles.headerReflection} />
          <p className={styles.householdEyebrow}>Household</p>
          <h1 className={styles.householdTitle}>{viewModel.householdName}</h1>
          <div className={styles.householdMeta}>
            <span>
              {viewModel.status === "loaded"
                ? `${viewModel.members.length} ${
                    viewModel.members.length === 1 ? "member" : "members"
                  }`
                : "Members"}
            </span>
            <span aria-hidden="true" className={styles.metaDivider} />
            <span>{roleTitle(viewModel.currentUserRole)}</span>
          </div>
        </header>

        <section aria-labelledby="household-week-title" className={styles.weekSection}>
          <p className={styles.sectionEyebrow}>This week / your people</p>
          <h2 className={styles.weekTitle} id="household-week-title">
            Everyone’s week.
          </h2>
          <div className={styles.progressLegend}>
            <span>Completed</span>
            <span aria-hidden="true">/</span>
            <span>Assigned</span>
          </div>
          <div className={styles.memberList}>
            {viewModel.status === "loading" && (
              <div aria-label="Loading household members" className={styles.loadingState}>
                {[0, 1, 2].map((item) => (
                  <div className={styles.memberSkeleton} key={item} />
                ))}
              </div>
            )}
            {viewModel.status === "error" && (
              <div className={styles.errorState}>
                <p role="alert">{viewModel.errorMessage ?? "Unable to load household members."}</p>
                <button
                  className={styles.secondaryFullButton}
                  onClick={props.onRetry}
                  type="button"
                >
                  Try again
                </button>
              </div>
            )}
            {viewModel.status === "loaded" && viewModel.refreshError && (
              <div className={styles.refreshNotice} role="alert">
                <p>{viewModel.refreshError}</p>
                <button onClick={props.onRetry} type="button">
                  Retry
                </button>
              </div>
            )}
            {viewModel.status === "loaded" && viewModel.members.length === 0 && (
              <div className={styles.emptyState}>No household members found.</div>
            )}
            {viewModel.status === "loaded" &&
              viewModel.members.map((member, index) => (
                <MemberRow
                  index={index}
                  key={member.userId}
                  member={member}
                  onMemberAction={props.onMemberAction}
                  onToggleMemberMenu={props.onToggleMemberMenu}
                  openMemberMenuId={props.openMemberMenuId}
                  theme={theme}
                  viewModel={viewModel}
                />
              ))}
          </div>
          <p className={styles.progressFootnote}>Each person’s progress on assigned chores.</p>
        </section>

        {viewModel.canManage && (
          <section
            aria-labelledby="household-management-title"
            className={styles.managementSection}
          >
            <div className={styles.managementHeading}>
              <h2 id="household-management-title">Manage household</h2>
              <span>Admin tools</span>
            </div>
            <button className={styles.inviteTile} onClick={props.onOpenInvite} type="button">
              <span aria-hidden="true" className={styles.inviteHalo} />
              <span aria-hidden="true" className={styles.invitePlus} />
              <span className={styles.inviteCopy}>
                <strong>Invite member</strong>
                <small>Share an invite code</small>
              </span>
              <span aria-hidden="true" className={styles.inviteChevron} />
            </button>
            <div className={styles.managementTiles}>
              <button
                className={styles.managementTile}
                onClick={props.onManageChores}
                type="button"
              >
                <span aria-hidden="true" className={styles.choresIcon} />
                <span aria-hidden="true" className={styles.tileChevron} />
                <strong>Manage chores</strong>
                <small>Create, edit, assign</small>
              </button>
              <button
                className={styles.managementTile}
                onClick={props.onHouseholdSettings}
                type="button"
              >
                <span aria-hidden="true" className={styles.settingsIcon} />
                <span aria-hidden="true" className={styles.tileChevron} />
                <strong>Household settings</strong>
                <small>Home details</small>
              </button>
            </div>
          </section>
        )}

        <section aria-labelledby="household-leave-section-title" className={styles.leaveSection}>
          <div className={styles.leaveHeading}>
            <span aria-hidden="true" className={styles.leaveSymbol} />
            <h2 id="household-leave-section-title">Leave household</h2>
          </div>
          <p className={styles.leaveDescription}>
            {viewModel.currentUserRole === "OWNER"
              ? "Transfer ownership before leaving. Past activity stays."
              : "You’ll lose access to future chores. Past activity stays."}
          </p>
          <button className={styles.leaveButton} onClick={props.onOpenLeave} type="button">
            Leave household
          </button>
          {props.leaveError && props.leaveFlow === "closed" && (
            <p className={styles.dialogError} role="alert">
              {props.leaveError}
            </p>
          )}
        </section>
        <div aria-hidden="true" className={styles.scrollEndPadding} />
      </main>
      <Navigation
        activeDestination={props.activeDestination}
        onNavigate={props.onNavigate}
        theme={theme}
      />
      {props.pendingMemberAction && (
        <MemberActionSheet
          busy={props.busyMemberId === props.pendingMemberAction.member.userId}
          confirmText={props.confirmText}
          error={props.memberActionError}
          householdName={viewModel.householdName}
          memberAction={props.pendingMemberAction}
          onCancel={props.onCloseMemberAction}
          onChangeConfirmText={props.onChangeConfirmText}
          onConfirm={props.onConfirmMemberAction}
        />
      )}
      <LeaveSheet props={props} />
      {props.previewInvite && props.onGeneratePreviewInvite && props.onClosePreviewInvite && (
        <PreviewInviteSheet
          invite={props.previewInvite}
          onClose={props.onClosePreviewInvite}
          onGenerate={props.onGeneratePreviewInvite}
        />
      )}
    </div>
  )
}
