package com.dirtyduty.app.entity;

import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(
    name = "household_memberships",
    uniqueConstraints = {
      @UniqueConstraint(
          name = "uq_household_membership",
          columnNames = {"household_id", "user_id"})
    },
    indexes = {
      @Index(name = "ix_memberships_user", columnList = "user_id"),
      @Index(name = "ix_memberships_household_status", columnList = "household_id, status")
    })
@Getter
@Setter
@NoArgsConstructor
public class HouseholdMembership {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  @Column(name = "id", nullable = false, updatable = false)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "household_id", nullable = false)
  private Household household;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @Enumerated(EnumType.STRING)
  @Column(name = "role", nullable = false, length = 20)
  private HouseholdRole role = HouseholdRole.MEMBER;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false, length = 20)
  private MembershipStatus status = MembershipStatus.ACTIVE;

  @Column(name = "joined_at")
  private OffsetDateTime joinedAt;

  @Column(name = "left_at")
  private OffsetDateTime leftAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private OffsetDateTime createdAt;

  @PrePersist
  protected void onCreate() {
    this.createdAt = OffsetDateTime.now();
    if (this.joinedAt == null && this.status == MembershipStatus.ACTIVE) {
      this.joinedAt = this.createdAt;
    }
  }
}
