package com.dirtyduty.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class TestDatabaseGuardTest {
  @Test
  void allowsTheCiProfileWithAScratchDatabase() {
    assertThatCode(
            () ->
                TestDatabaseGuard.check(
                    List.of("ci"), "jdbc:postgresql://localhost:5432/dirtyduty_test_123"))
        .doesNotThrowAnyException();
  }

  @Test
  void refusesTheDevelopmentDatabase() {
    assertThatThrownBy(
            () ->
                TestDatabaseGuard.check(
                    List.of("ci"), "jdbc:postgresql://localhost:5432/dirtyduty?sslmode=disable"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("development database \"dirtyduty\"")
        .hasMessageContaining("test-local.sh");
  }

  @Test
  void refusesNonTestProfiles() {
    String scratch = "jdbc:postgresql://localhost:5432/dirtyduty_ci";
    assertThatThrownBy(() -> TestDatabaseGuard.check(List.of("local"), scratch))
        .hasMessageContaining("[local]");
    assertThatThrownBy(() -> TestDatabaseGuard.check(List.of("ci", "prod"), scratch))
        .hasMessageContaining("test profile");
    assertThatThrownBy(() -> TestDatabaseGuard.check(List.of("default"), scratch))
        .hasMessageContaining("test profile");
  }

  @Test
  void readsTheDatabaseName() {
    assertThat(TestDatabaseGuard.databaseName("jdbc:postgresql://h:5432/name?x=1"))
        .isEqualTo("name");
    assertThat(TestDatabaseGuard.databaseName("jdbc:postgresql://h:5432/")).isNull();
    assertThat(TestDatabaseGuard.databaseName(null)).isNull();
  }
}
