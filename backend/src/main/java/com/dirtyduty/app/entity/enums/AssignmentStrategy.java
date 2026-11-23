package com.dirtyduty.app.entity.enums;

public enum AssignmentStrategy {
  MANUAL,
  FIXED,
  ROUND_ROBIN,
  RANDOM,
  /** Whoever has the least fairness effort per present day lately (E8). */
  BALANCED
}
