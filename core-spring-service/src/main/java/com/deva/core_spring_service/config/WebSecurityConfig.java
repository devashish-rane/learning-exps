package com.deva.core_spring_service.config;

import org.springframework.boot.actuate.autoconfigure.security.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class WebSecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable()) // for APIs
                .headers(headers -> headers.frameOptions().disable())
                // .authorizeHttpRequests(auth -> auth
                //         // Permit health and info via Actuator matcher (most reliable)
                //         .requestMatchers(EndpointRequest.to("health", "info")).permitAll()
                //         // Permit API routes
                //         .requestMatchers("/api/**").permitAll()
                //         // H2 console in dev (optional)
                //         .requestMatchers("/h2-console/**").permitAll()
                //         .anyRequest().authenticated()
                // )
                // .httpBasic(Customizer.withDefaults()); // username/password popup
                .authorizeHttpRequests(auth -> auth
                        .anyRequest().permitAll()
                );
        return http.build();
    }
}
