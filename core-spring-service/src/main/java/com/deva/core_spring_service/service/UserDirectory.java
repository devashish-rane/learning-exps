package com.deva.core_spring_service.service;

import com.deva.core_spring_service.model.UserProfile;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

@Service
public class UserDirectory {
    private static final Map<String, UserProfile> USERS = Map.of(
            "demo", new UserProfile("demo", "John Doe", "john.doe@example.com"),
            "alice", new UserProfile("alice", "Alice Smith", "alice@example.com"),
            "bob", new UserProfile("bob", "Bob Stone", "bob@example.com")
    );

    public Optional<UserProfile> findById(String id) {
        return Optional.ofNullable(USERS.get(id.toLowerCase()));
    }
}
