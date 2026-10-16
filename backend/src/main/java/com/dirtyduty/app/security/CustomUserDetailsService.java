package com.dirtyduty.app.security;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.repository.UserRepository;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class CustomUserDetailsService implements UserDetailsService {

  private final UserRepository userRepository;

  public CustomUserDetailsService(UserRepository userRepository) {
    this.userRepository = userRepository;
  }

  @Override
  public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
    User user =
        userRepository
            .findByEmailIgnoreCase(username)
            .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));

    boolean enabled = user.getAccountStatus() == AccountStatus.ACTIVE;

    boolean hasPassword = user.getPasswordHash() != null;
    return org.springframework.security.core.userdetails.User.withUsername(user.getEmail())
        .password(
            hasPassword
                ? user.getPasswordHash()
                : "{noop}disabled-because-no-local-password-is-set")
        .authorities("ROLE_USER")
        .accountLocked(!enabled)
        .disabled(!enabled || !hasPassword)
        .build();
  }
}
