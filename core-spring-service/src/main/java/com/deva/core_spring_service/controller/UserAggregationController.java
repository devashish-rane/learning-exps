package com.deva.core_spring_service.controller;

import com.deva.core_spring_service.exception.NotFoundException;
import com.deva.core_spring_service.model.UserAggregateResponse;
import com.deva.core_spring_service.model.UserProfile;
import com.deva.core_spring_service.model.UserStatus;
import com.deva.core_spring_service.service.ProducerClient;
import com.deva.core_spring_service.service.UserDirectory;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class UserAggregationController {

    private final UserDirectory userDirectory;
    private final ProducerClient producerClient;

    public UserAggregationController(UserDirectory userDirectory, ProducerClient producerClient) {
        this.userDirectory = userDirectory;
        this.producerClient = producerClient;
    }

    @GetMapping("/user/{id}")
    public ResponseEntity<UserAggregateResponse> aggregate(@PathVariable String id) {
        UserProfile profile = userDirectory.findById(id)
                .orElseThrow(() -> new NotFoundException("User %s not found".formatted(id)));

        UserStatus status = producerClient.fetchStatus(profile.id());
        String idFromMdc = MDC.get("traceId");
        if (idFromMdc == null || idFromMdc.isBlank()) {
            idFromMdc = MDC.get("correlationId");
        }
        UserAggregateResponse response = new UserAggregateResponse(
                profile.id(),
                profile.name(),
                profile.email(),
                status.loggedIn(),
                idFromMdc
        );
        return ResponseEntity.ok(response);
    }
}
