package com.deva.core_spring_service.repository;

import com.deva.core_spring_service.model.UserDetail;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterAll;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.AssertionsForInterfaceTypes.assertThat;

/**
 * Integration test for UserRepository using Testcontainers with PostgreSQL.
 *
 * This test spins up a real PostgreSQL database inside a lightweight Docker
 * container, configures Spring Boot to use it, runs the test, and automatically
 * tears down the container afterward.
 */

@Testcontainers // <--- Tells JUnit to manage the Testcontainers lifecycle automatically.
@SpringBootTest  // <--- Boots up the full Spring context (beans, repos, etc.) for integration testing.
class UserRepositoryIntegrationTest {

    /**
     * Define a PostgreSQL container to be shared across tests.
     *
     * - "postgres:16" → the Docker image version to use
     * - withDatabaseName("testdb") → the database name inside the container
     * - withUsername/withPassword → credentials used by Spring Boot datasource
     *
     * NOTE:
     * @Container annotation makes Testcontainers automatically start this container
     * before any test runs and stop it after all tests finish.
     */
    @Container
    static PostgreSQLContainer<?> postgres =
            new PostgreSQLContainer<>("postgres:16")
                    .withDatabaseName("testdb")
                    .withUsername("test")
                    .withPassword("test");

    /**
     * This method dynamically wires the running container's connection details
     * into Spring Boot's environment at runtime.
     *
     * Instead of using application.properties, it overrides:
     *  - spring.datasource.url
     *  - spring.datasource.username
     *  - spring.datasource.password
     *
     * Spring Boot then uses this real PostgreSQL instance for all DataSource operations.
     */
    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Autowired
    private UserDetailsRepository userRepository;  // Inject your JPA repository for testing

    /**
     * Test case: verifies that a user can be persisted and retrieved from the
     * PostgreSQL container database.
     */
    @Test
    public void testUserSave() {
        // Create a new user entity
        UserDetail user = new UserDetail();
        user.setName("Alice");

        // Save to DB (goes to the Testcontainer PostgreSQL instance)
        userRepository.save(user);

        // Fetch all users and verify one record exists
        List<UserDetail> all = userRepository.findAll();
        assertThat(all).hasSize(1);
    }

    /**
     * Optional cleanup: if you want to explicitly stop the container after tests,
     * though @Container already handles this automatically.
     *
     * You can use @AfterAll if you want to free resources early or ensure explicit cleanup.
     */
    @AfterAll
    static void tearDown() {
        if (postgres != null && postgres.isRunning()) {
            postgres.stop();  // Gracefully stop container
        }
    }
}

