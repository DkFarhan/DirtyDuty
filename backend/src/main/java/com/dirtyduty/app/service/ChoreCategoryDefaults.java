package com.dirtyduty.app.service;

import com.dirtyduty.app.entity.ChoreCategory;
import com.dirtyduty.app.entity.Household;
import com.dirtyduty.app.repository.ChoreCategoryRepository;
import java.util.List;

final class ChoreCategoryDefaults {

    private static final List<CategorySeed> CATEGORIES = List.of(
            new CategorySeed("Kitchen", "kitchen"),
            new CategorySeed("Bathroom", "bathroom"),
            new CategorySeed("Laundry", "laundry"),
            new CategorySeed("Trash", "trash"),
            new CategorySeed("Cleaning", "broom"),
            new CategorySeed("General", "home"));

    private ChoreCategoryDefaults() {
    }

    static void ensureFor(Household household, ChoreCategoryRepository repository) {
        if (!repository.findByHousehold_IdOrderBySortOrderAscNameAsc(household.getId()).isEmpty()) {
            return;
        }

        List<ChoreCategory> defaults = new java.util.ArrayList<>(CATEGORIES.size());
        for (int index = 0; index < CATEGORIES.size(); index++) {
            CategorySeed seed = CATEGORIES.get(index);
            ChoreCategory category = new ChoreCategory();
            category.setHousehold(household);
            category.setName(seed.name());
            category.setIconKey(seed.iconKey());
            category.setSortOrder(index);
            defaults.add(category);
        }
        repository.saveAll(defaults);
    }

    private record CategorySeed(String name, String iconKey) {
    }
}
