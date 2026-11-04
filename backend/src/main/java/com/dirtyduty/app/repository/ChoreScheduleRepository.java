package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.ChoreSchedule;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ChoreScheduleRepository extends JpaRepository<ChoreSchedule, UUID> {

  Optional<ChoreSchedule> findByChore_IdAndHousehold_Id(UUID choreId, UUID householdId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select s from ChoreSchedule s where s.id = :scheduleId")
  Optional<ChoreSchedule> findByIdForUpdate(@Param("scheduleId") UUID scheduleId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "select s from ChoreSchedule s "
          + "where s.chore.id = :choreId and s.household.id = :householdId")
  Optional<ChoreSchedule> findByChore_IdAndHousehold_IdForUpdate(
      @Param("choreId") UUID choreId, @Param("householdId") UUID householdId);

  List<ChoreSchedule> findByHousehold_IdAndActiveTrue(UUID householdId);
}
