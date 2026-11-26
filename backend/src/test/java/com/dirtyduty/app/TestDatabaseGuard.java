package com.dirtyduty.app;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

/**
 * Stops every Spring test context before it touches a database that isn't a test one. Tests run
 * with the {@code ci} profile by default (src/test/resources/config/application.properties); the
 * guard fails fast when another profile is active, or when the JDBC URL names the local development
 * database ({@code dirtyduty}), so test accounts can never be written into it again.
 *
 * <p>Registered for all tests in src/test/resources/META-INF/spring.factories.
 */
public class TestDatabaseGuard
    implements ApplicationContextInitializer<ConfigurableApplicationContext> {
  static final Set<String> TEST_PROFILES = Set.of("ci", "test");
  static final Set<String> FORBIDDEN_DATABASES = Set.of("dirtyduty");
  static final String HOW_TO_RUN =
      "Run backend tests against a scratch database: ./scripts/test-local.sh (see backend/README.md).";

  @Override
  public void initialize(ConfigurableApplicationContext context) {
    ConfigurableEnvironment environment = context.getEnvironment();
    List<String> profiles =
        Arrays.asList(
            environment.getActiveProfiles().length > 0
                ? environment.getActiveProfiles()
                : environment.getDefaultProfiles());
    check(profiles, environment.getProperty("spring.datasource.url"));
  }

  static void check(List<String> profiles, String jdbcUrl) {
    if (profiles.stream().noneMatch(TEST_PROFILES::contains)
        || profiles.stream().anyMatch(profile -> !TEST_PROFILES.contains(profile))) {
      throw new IllegalStateException(
          "Backend tests must run with only a test profile (ci or test), but the active profiles are "
              + profiles
              + ". Unset SPRING_PROFILES_ACTIVE (for example from .env.local). "
              + HOW_TO_RUN);
    }
    String database = databaseName(jdbcUrl);
    if (database == null || FORBIDDEN_DATABASES.contains(database.toLowerCase(Locale.ROOT))) {
      throw new IllegalStateException(
          "Backend tests refuse to run against "
              + (database == null
                  ? "an unknown database"
                  : "the development database \"" + database + "\"")
              + " ("
              + jdbcUrl
              + "). Point DB_URL at a scratch database. "
              + HOW_TO_RUN);
    }
  }

  /** The database name in a JDBC URL such as jdbc:postgresql://host:5432/name?options. */
  static String databaseName(String jdbcUrl) {
    if (jdbcUrl == null || jdbcUrl.isBlank()) {
      return null;
    }
    String path = jdbcUrl;
    int query = path.indexOf('?');
    if (query >= 0) {
      path = path.substring(0, query);
    }
    int slash = path.lastIndexOf('/');
    if (slash < 0 || slash == path.length() - 1 || path.substring(0, slash).endsWith("/")) {
      return null;
    }
    return path.substring(slash + 1);
  }
}
