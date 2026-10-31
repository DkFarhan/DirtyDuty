"use client"

import { useEffect, useState } from "react"
import type { HouseholdNavigationDestination, HouseholdVisualTheme } from "./household-screen-view"
import { HouseholdScreenView } from "./household-screen-view"
import {
  createHouseholdPreviewFixture,
  householdPreviewScenarios,
  householdPreviewScenarioLabel,
  type HouseholdPreviewFixture,
  type HouseholdPreviewScenario,
} from "./household-preview-fixtures"
import styles from "./household-design-preview.module.css"

function isScenario(value: string | null): value is HouseholdPreviewScenario {
  return value !== null && householdPreviewScenarios.includes(value as HouseholdPreviewScenario)
}

export function HouseholdDesignPreview() {
  const [theme, setTheme] = useState<HouseholdVisualTheme>("dark")
  const [scenario, setScenario] = useState<HouseholdPreviewScenario>("admin-3")
  const [fixture, setFixture] = useState<HouseholdPreviewFixture>(() =>
    createHouseholdPreviewFixture("admin-3"),
  )
  const [activeDestination, setActiveDestination] =
    useState<HouseholdNavigationDestination>("household")
  const [captureMode, setCaptureMode] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("theme") === "light") setTheme("light")
    setCaptureMode(params.get("capture") === "1")
    const initialScenario = params.get("state")
    if (isScenario(initialScenario)) {
      setScenario(initialScenario)
      setFixture(createHouseholdPreviewFixture(initialScenario))
    }
  }, [])

  const selectScenario = (nextScenario: HouseholdPreviewScenario) => {
    setScenario(nextScenario)
    setFixture(createHouseholdPreviewFixture(nextScenario))
  }

  const closeMemberAction = () => {
    setFixture((current) => ({
      ...current,
      pendingMemberAction: null,
      confirmText: "",
      memberActionError: null,
    }))
  }

  const openLeave = () => {
    const isOwner = fixture.viewModel.currentUserRole === "OWNER"
    setFixture((current) => ({
      ...current,
      leaveFlow: isOwner ? "owner-select" : "member-confirm",
      leaveError: null,
      selectedNewOwnerId: "",
    }))
  }

  return (
    <div className={styles.previewRoot}>
      {!captureMode && (
        <div aria-label="Household design preview controls" className={styles.previewControls}>
          <div aria-label="Preview theme" className={styles.themeControls}>
            <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} type="button">
              Dark
            </button>
            <button
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              type="button"
            >
              Light
            </button>
          </div>
          <label>
            <span className={styles.visuallyHidden}>Preview state</span>
            <select
              aria-label="Preview state"
              onChange={(event) =>
                selectScenario(event.currentTarget.value as HouseholdPreviewScenario)
              }
              value={scenario}
            >
              {householdPreviewScenarios.map((value) => (
                <option key={value} value={value}>
                  {householdPreviewScenarioLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <HouseholdScreenView
        activeDestination={activeDestination}
        busyMemberId={null}
        confirmText={fixture.confirmText}
        leaveBusy={false}
        leaveError={fixture.leaveError}
        leaveFlow={fixture.leaveFlow}
        memberActionError={fixture.memberActionError}
        phonePreview
        onChangeConfirmText={(confirmText) =>
          setFixture((current) => ({ ...current, confirmText }))
        }
        onCloseLeave={() =>
          setFixture((current) => ({
            ...current,
            leaveFlow: "closed",
            leaveError: null,
          }))
        }
        onBackToSuccessorSelection={() =>
          setFixture((current) => ({
            ...current,
            leaveFlow: "owner-select",
            leaveError: null,
          }))
        }
        onCloseMemberAction={closeMemberAction}
        onClosePreviewInvite={() => setFixture((current) => ({ ...current, previewInvite: null }))}
        onConfirmLeave={() =>
          setFixture((current) => ({ ...current, leaveFlow: "closed", leaveError: null }))
        }
        onConfirmMemberAction={closeMemberAction}
        onContinueOwnerLeave={() =>
          setFixture((current) => ({ ...current, leaveFlow: "owner-confirm", leaveError: null }))
        }
        onGeneratePreviewInvite={() =>
          setFixture((current) => ({
            ...current,
            previewInvite: {
              status: "created",
              code: "PREVIEW-ONE-TIME-CODE",
              expiresAt: "Oct 31, 2026",
            },
          }))
        }
        onHouseholdSettings={() => setActiveDestination("profile")}
        onManageChores={() => setActiveDestination("my-chores")}
        onMemberAction={(action, member) =>
          setFixture((current) => ({
            ...current,
            openMemberMenuId: null,
            pendingMemberAction: { action, member },
            confirmText: "",
          }))
        }
        onNavigate={setActiveDestination}
        onOpenInvite={() =>
          setFixture((current) => ({
            ...current,
            previewInvite: { status: "ready" },
          }))
        }
        onOpenLeave={openLeave}
        onRetry={() =>
          setFixture((current) => ({
            ...current,
            viewModel: {
              ...current.viewModel,
              status: "loaded",
              errorMessage: undefined,
              refreshError: undefined,
              members:
                current.viewModel.members.length > 0
                  ? current.viewModel.members
                  : createHouseholdPreviewFixture("admin-3").viewModel.members,
            },
          }))
        }
        onSelectSuccessor={(memberId) =>
          setFixture((current) => ({ ...current, selectedNewOwnerId: memberId }))
        }
        onToggleMemberMenu={(memberId) =>
          setFixture((current) => ({
            ...current,
            openMemberMenuId: current.openMemberMenuId === memberId ? null : memberId,
          }))
        }
        openMemberMenuId={fixture.openMemberMenuId}
        pendingMemberAction={fixture.pendingMemberAction}
        previewInvite={fixture.previewInvite}
        selectedNewOwnerId={fixture.selectedNewOwnerId}
        theme={theme}
        viewModel={fixture.viewModel}
      />
    </div>
  )
}
