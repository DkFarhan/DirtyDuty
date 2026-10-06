package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.ChoreSchedule;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChoreScheduleRepository extends JpaRepository<ChoreSchedule, UUID> {

  Optional<ChoreSchedule> findByChore_IdAndHousehold_Id(UUID choreId, UUID householdId);

  List<ChoreSchedule> findByHousehold_IdAndActiveTrue(UUID householdId);
}
