package com.dirtyduty.app.service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Icon keys a chore category may store. The frontend keeps the same list in {@code
 * frontend/lib/household/category-icons.ts}; a frontend test fails if the two drift apart.
 */
public final class ChoreCategoryIcons {

  /** Keys offered in the icon picker, in display order. */
  public static final List<String> PICKER =
      List.of(
          "kitchen",
          "dishes",
          "bathroom",
          "laundry",
          "cleaning",
          "trash",
          "recycling",
          "bins",
          "plants",
          "outdoor",
          "shopping",
          "groceries",
          "pets",
          "kids",
          "car",
          "maintenance",
          "general");

  /**
   * Keys accepted for compatibility: the original default seeds ("broom", "home"), the aliases
   * "garden", "yard" and "tools", and every emoji or keyword the original icon renderer mapped.
   */
  public static final List<String> LEGACY =
      List.of(
          "broom", "home", "garden", "yard", "tools", "bath", "wash", "garbage", "dish", "plant",
          "shop", "recycle", "🧹", "🗑️", "🛁", "🧺", "🍽️", "🌀", "🫧", "♻️", "🪴", "🛒", "🧽",
          "🪣", "🏠");

  private static final Set<String> ALLOWED = allowed();

  private ChoreCategoryIcons() {}

  public static boolean isAllowed(String iconKey) {
    return iconKey != null && ALLOWED.contains(iconKey);
  }

  private static Set<String> allowed() {
    Set<String> keys = new LinkedHashSet<>(PICKER);
    keys.addAll(LEGACY);
    return Set.copyOf(keys);
  }
}
