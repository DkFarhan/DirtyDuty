package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.Household;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HouseholdRepository extends JpaRepository<Household, UUID> {
}
