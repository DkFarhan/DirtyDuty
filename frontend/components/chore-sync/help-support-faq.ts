export type FaqItem = {
  id: string
  question: string
  answer: string
}

export type FaqCategory = {
  id: string
  title: string
  items: FaqItem[]
}

export const faqCategories: FaqCategory[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      {
        id: "what-is-dirtyduty",
        question: "What is DirtyDuty?",
        answer:
          "DirtyDuty helps your household organize chores, assignments, due dates, and progress in one place.",
      },
      {
        id: "create-household",
        question: "How do I create a household?",
        answer:
          "Choose Create a household from the welcome flow, enter a household name and time zone, and follow the prompts. The person who creates it becomes its Owner.",
      },
      {
        id: "join-household",
        question: "How do I join an existing household?",
        answer:
          "Ask a household Owner or Admin for an invitation. Open the join flow and enter the valid invitation code.",
      },
      {
        id: "multiple-households",
        question: "Can I belong to more than one household?",
        answer:
          "Yes. One account can be an active member of more than one household, but the current app does not have a general household switcher. Joining a household requires a valid invitation.",
      },
      {
        id: "my-chores",
        question: "Where can I see the chores assigned to me?",
        answer:
          "Open My Chores to review your assigned work and its due dates. The dashboard also highlights chores scheduled for today and this week.",
      },
    ],
  },
  {
    id: "members-and-roles",
    title: "Members & Roles",
    items: [
      {
        id: "roles",
        question: "What are the Owner, Admin, and Member roles?",
        answer:
          "Owners manage the household, invite members, manage chores, manage roles, transfer ownership, and delete the household. Admins can invite members and manage chores, and can manage or remove regular members—but not the Owner or another Admin. Members can take part in household activities and complete chores assigned to them.",
      },
      {
        id: "invite-member",
        question: "How do I invite someone to my household?",
        answer:
          "An Owner or Admin can create an invitation from the Household area. Share the invitation with the person who should join.",
      },
      {
        id: "invitation-not-working",
        question: "Why isn't an invitation working?",
        answer:
          "An invitation may no longer be usable if it is invalid, expired, revoked, or already used. Ask an Owner or Admin to check active invitations and create a new one if needed.",
      },
      {
        id: "revoke-invitation",
        question: "Can I revoke an invitation?",
        answer:
          "Yes. An Owner or Admin can revoke an active invitation from Household Settings. A revoked invitation can no longer be used.",
      },
      {
        id: "rejoin-household",
        question: "Can someone who left or was removed join again?",
        answer:
          "Yes, if an Owner or Admin provides a new valid invitation. Rejoining does not automatically restore a previous elevated role.",
      },
      {
        id: "remove-member",
        question: "How do I remove a household member?",
        answer:
          "An Owner or Admin can remove eligible members from the Household members list. Admins cannot remove the Owner or another Admin, and you cannot remove yourself from this list.",
      },
      {
        id: "transfer-ownership",
        question: "How do I transfer household ownership?",
        answer:
          "From the Household members list, choose an active member and select Transfer ownership. Only the current Owner can transfer ownership.",
      },
      {
        id: "leave-household",
        question: "How do I leave a household?",
        answer:
          "Members and Admins can leave from the Household area. An Owner must transfer ownership to another active member first. If you are the only eligible active member, invite someone or delete the household before you can leave.",
      },
    ],
  },
  {
    id: "chores-and-assignments",
    title: "Chores & Assignments",
    items: [
      {
        id: "create-chore",
        question: "How do I create a chore?",
        answer:
          "An Owner or Admin can open chore management from the Household area and add a chore with its schedule and assignment settings.",
      },
      {
        id: "manage-chores",
        question: "Who can edit, pause, or archive chores?",
        answer:
          "Owners and Admins can create and manage chores, including editing, pausing, and archiving them. Members can view and complete chores assigned to them.",
      },
      {
        id: "assignment-types",
        question: "How are chores assigned?",
        answer:
          "Depending on the chore setup, assignees can be selected directly, rotated among participants, or chosen randomly. A chore can also be shared by multiple people when configured to need more than one person.",
      },
      {
        id: "people-needed",
        question: 'What does "people needed" mean?',
        answer:
          "It sets how many household members should be assigned to each occurrence of that chore. For example, a chore that needs two people is assigned to two eligible members.",
      },
      {
        id: "shared-completion",
        question: "What happens when a chore has multiple assignees?",
        answer:
          "Any active co-assignee can complete the shared occurrence. Once it is completed, everyone assigned to that occurrence sees it as complete.",
      },
      {
        id: "round-robin",
        question: "How does round-robin assignment work?",
        answer:
          "DirtyDuty rotates assignments among the eligible participants so chores are shared across the group over time.",
      },
      {
        id: "random-assignments",
        question: "Are random assignments saved?",
        answer:
          "Yes. When assignees are generated for an occurrence, those assignments stay with that occurrence.",
      },
      {
        id: "member-removed-assignments",
        question: "What happens to chores when a member leaves or is removed?",
        answer:
          "The person no longer participates as an active household member. Their pending notifications are cancelled, and schedules may be paused if the household no longer has enough eligible people.",
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    items: [
      {
        id: "notification-types",
        question: "What notifications can DirtyDuty send?",
        answer:
          "DirtyDuty can show in-app notifications and, when enabled and available for your browser, send web push notifications. Your notification preferences control which updates you receive.",
      },
      {
        id: "reminder-times",
        question: "When are chore reminders sent?",
        answer:
          "With the default Aggressive reminder schedule, reminders are set for 24, 6, and 1 hour before a chore is due, at the due time, and 1 and 3 hours after. The household's reminder mode determines which enabled rules apply, and reminders scheduled in the past are skipped.",
      },
      {
        id: "notification-styles",
        question: "What notification styles are available?",
        answer:
          "You can choose Normal, Funny, Motivational, Competitive, or Minimal. Your personal style preference may override the household's default.",
      },
      {
        id: "push-notifications",
        question: "Why am I not receiving push notifications?",
        answer:
          "Check that push notifications are enabled in DirtyDuty and allowed for this browser, and that the browser has an active subscription. Push also needs to be available for the current environment. Your notification preferences can turn off particular reminders.",
      },
      {
        id: "completed-reminders",
        question: "Will reminders continue after I complete a chore?",
        answer:
          "No. Completing an occurrence stops its future reminders. Reminders that are no longer valid are not sent.",
      },
    ],
  },
  {
    id: "account-and-security",
    title: "Account & Security",
    items: [
      {
        id: "change-password",
        question: "How do I change my password?",
        answer:
          "Open Privacy & Security from your profile and use Change password. After a successful change, you are signed out of active sessions and need to sign in again with your new password.",
      },
      {
        id: "delete-account",
        question: "What happens if I delete my account?",
        answer:
          "Account deletion is permanent. DirtyDuty replaces your account details with a generic deleted-member identity, while household membership history may remain. You must handle any households you own first. You can later register again with the same email, but the new account will not inherit your old memberships or history.",
      },
      {
        id: "cannot-delete-account",
        question: "Why can't I delete my account while I own a household?",
        answer:
          "An Owner must first transfer ownership or delete each household they own. Once no active household remains under your ownership, you can continue with account deletion.",
      },
    ],
  },
  {
    id: "household-data",
    title: "Household Data",
    items: [
      {
        id: "delete-household",
        question: "What happens when a household is deleted?",
        answer:
          "Only the Owner can delete a household. The confirmation asks you to acknowledge the impact, type the exact household name, and enter your current password. Deletion is permanent and removes the household and its associated chores, categories, invitations, memberships, and household notifications.",
      },
    ],
  },
]
