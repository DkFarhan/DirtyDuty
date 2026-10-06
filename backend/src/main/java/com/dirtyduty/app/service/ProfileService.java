package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.profile.ProfileResponse;
import com.dirtyduty.app.dto.profile.UpdateProfileRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.exception.InvalidHouseholdException;
import com.dirtyduty.app.exception.ResourceNotFoundException;
import com.dirtyduty.app.repository.UserRepository;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {
  private final JdbcTemplate jdbc;
  private final UserRepository userRepository;

  public ProfileService(JdbcTemplate jdbc, UserRepository userRepository) {
    this.jdbc = jdbc;
    this.userRepository = userRepository;
  }

  @Transactional(readOnly = true)
  public ProfileResponse get(Authentication authentication) {
    User user = currentUser(authentication);
    return jdbc.queryForObject(
        """
                SELECT u.id, u.display_name, u.email, u.avatar_url,
                       (SELECT h.name FROM household_memberships m
                        JOIN households h ON h.id=m.household_id
                        WHERE m.user_id=u.id AND m.status='ACTIVE'
                        ORDER BY h.created_at LIMIT 1) household_name,
                       (SELECT COUNT(DISTINCT a.id) FROM chore_assignment_assignees aa
                        JOIN chore_assignments a ON a.id=aa.assignment_id
                        WHERE aa.user_id=u.id AND a.status<>'CANCELLED') assigned,
                       (SELECT COUNT(DISTINCT a.id) FROM chore_assignment_assignees aa
                        JOIN chore_assignments a ON a.id=aa.assignment_id
                        WHERE aa.user_id=u.id AND a.status='COMPLETED') completed
                FROM users u WHERE u.id=?
                """,
        (rs, row) -> {
          long assigned = rs.getLong("assigned");
          long completed = rs.getLong("completed");
          double rate = assigned == 0 ? 0 : Math.round(completed * 1000.0 / assigned) / 10.0;
          return new ProfileResponse(
              rs.getObject("id", UUID.class),
              rs.getString("display_name"),
              rs.getString("email"),
              rs.getString("avatar_url"),
              rs.getString("household_name"),
              assigned,
              completed,
              rate);
        },
        user.getId());
  }

  @Transactional
  public ProfileResponse update(UpdateProfileRequest request, Authentication authentication) {
    String displayName = request.displayName().strip();
    if (displayName.isEmpty() || displayName.length() > 100) {
      throw new InvalidHouseholdException("Display name must be between 1 and 100 characters.");
    }
    User user = currentUser(authentication);
    user.setDisplayName(displayName);
    userRepository.save(user);
    return get(authentication);
  }

  private User currentUser(Authentication authentication) {
    if (authentication == null || authentication.getName() == null) {
      throw new ResourceNotFoundException("Authenticated user was not found.");
    }
    return userRepository
        .findByEmailIgnoreCase(authentication.getName())
        .orElseThrow(() -> new ResourceNotFoundException("Authenticated user was not found."));
  }
}
