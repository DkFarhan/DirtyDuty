package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.Chore;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChoreRepository extends JpaRepository<Chore, UUID> {

  List<Chore> findByHousehold_IdAndArchivedAtIsNullOrderByCreatedAtDesc(UUID householdId);

  List<Chore> findByHousehold_IdOrderByCreatedAtDesc(UUID householdId);

  Optional<Chore> findByIdAndHousehold_Id(UUID id, UUID householdId);
}
