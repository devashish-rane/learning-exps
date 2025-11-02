package com.deva.core_spring_service.config;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class RegistryInspector implements CommandLineRunner {
    private final MeterRegistry registry;
    public RegistryInspector(MeterRegistry registry) { this.registry = registry; }

    @Override
    public void run(String... args) {
        registry.counter("cw.test.metric", "env", "local").increment();
        System.out.println(">>> Micrometer Registry class: " + registry.getClass().getName());
    }
}

