package com.dirtyduty.app.entity;

import com.dirtyduty.app.entity.enums.AssignmentStrategy;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "chore_schedules")
@Getter
@Setter
@NoArgsConstructor
public class ChoreSchedule {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "id", nullable = false, updatable = false)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "household_id", nullable = false)
  private Household household;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "chore_id", nullable = false)
  private Chore chore;

  @Column(name = "recurrence_rule", nullable = false)
  private String recurrenceRule;

  @Column(name = "timezone", nullable = false, length = 100)
  private String timezone;

  @Column(name = "starts_on", nullable = false)
  private LocalDate startsOn;

  @Column(name = "ends_on")
  private LocalDate endsOn;

  @Column(name = "due_time")
  private LocalTime dueTime;

  @Enumerated(EnumType.STRING)
  @Column(name = "assignment_strategy", nullable = false, length = 30)
  private AssignmentStrategy assignmentStrategy = AssignmentStrategy.MANUAL;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "fixed_assignee_user_id")
  private User fixedAssignee;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "strategy_config", nullable = false, columnDefinition = "jsonb")
  private Map<String, Object> strategyConfig = new HashMap<>();

  @Column(name = "is_active", nullable = false)
  private boolean active = true;

  @Column(name = "created_at", nullable = false, updatable = false)
  private OffsetDateTime createdAt;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  @PrePersist
  protected void onCreate() {
    OffsetDateTime now = OffsetDateTime.now();
    createdAt = now;
    updatedAt = now;
  }

  @PreUpdate
  protected void onUpdate() {
    updatedAt = OffsetDateTime.now();
  }
}
