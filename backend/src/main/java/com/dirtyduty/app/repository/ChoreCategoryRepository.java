package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.ChoreCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChoreCategoryRepository extends JpaRepository<ChoreCategory, UUID> {

    List<ChoreCategory> findByHousehold_IdOrderBySortOrderAscNameAsc(UUID householdId);
}
