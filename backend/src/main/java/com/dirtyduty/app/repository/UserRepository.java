package com.dirtyduty.app.repository;

import com.dirtyduty.app.entity.User;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

  Optional<User> findByEmailIgnoreCase(String email);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select user from User user where lower(user.email) = lower(:email)")
  Optional<User> findByEmailIgnoreCaseForUpdate(@Param("email") String email);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select user from User user where user.id = :id")
  Optional<User> findByIdForUpdate(@Param("id") UUID id);

  boolean existsByEmailIgnoreCase(String email);
}
