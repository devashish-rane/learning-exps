package com.deva.core_spring_service.controller;

import com.deva.core_spring_service.service.ProducerClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/proxy")
public class ProducerHealthController {

    private final ProducerClient producerClient;

    public ProducerHealthController(ProducerClient producerClient) {
        this.producerClient = producerClient;
    }

    @GetMapping("/producer-health")
    public ResponseEntity<Map<String, Object>> health() {
        boolean healthy = producerClient.isHealthy();
        return ResponseEntity.ok(Map.of("producerUp", healthy));
    }
}
