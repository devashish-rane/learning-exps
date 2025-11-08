package com.deva.producer.controller;

import com.deva.producer.model.UserStatusResponse;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Random;

@RestController
public class StatusController {
    private static final Logger log = LoggerFactory.getLogger(StatusController.class);
    private final Random random = new Random();

    @GetMapping("/status")
    public ResponseEntity<UserStatusResponse> status(
            @RequestParam("userId") @NotBlank String userId,
            @RequestParam(value = "delayMs", required = false) Integer delayMs,
            @RequestParam(value = "unstable", required = false, defaultValue = "false") boolean unstable
    ) throws InterruptedException {
        if (delayMs != null && delayMs > 0) {
            Thread.sleep(Math.min(delayMs, 5_000));
        }

        if (unstable && random.nextBoolean()) {
            log.warn("Simulated failure for user {}", userId);
            return ResponseEntity.status(503).build();
        }

        boolean loggedIn = random.nextBoolean();
        return ResponseEntity.ok(new UserStatusResponse(userId, loggedIn));
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("OK");
    }
}
