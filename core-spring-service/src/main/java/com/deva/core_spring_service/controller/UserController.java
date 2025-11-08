package com.deva.core_spring_service.controller;


import com.deva.core_spring_service.model.UserDetail;
import com.deva.core_spring_service.repository.UserDetailsRepository;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class UserController {

    UserDetailsRepository userDetailsRepository;

    //    constructure inj implicit
    public UserController(UserDetailsRepository userDetailsRepository){
        this.userDetailsRepository = userDetailsRepository;
    }

    @PostMapping("/user")
    public ResponseEntity<UserDetail> createUser(@Valid @RequestBody UserDetail userDetail) {
        UserDetail saved = userDetailsRepository.save(userDetail);
        URI location = ServletUriComponentsBuilder
                .fromCurrentRequest()
                .path("/{id}")
                .buildAndExpand(saved.getId())
                .toUri();
        return ResponseEntity.created(location).body(saved);
    }


    @GetMapping("/user")
    public ResponseEntity<List<UserDetail>> getAllUsers() {
        List<UserDetail> users = userDetailsRepository.findAll();

        if (users.isEmpty()) {
            return ResponseEntity.noContent().build(); // 204 No Content
        }

        return ResponseEntity.ok(users); // 200 OK with list
    }


    @DeleteMapping("/user/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable UUID id) {
        if (!userDetailsRepository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        userDetailsRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }


    @PutMapping("/user/{id}")
    ResponseEntity<UserDetail> updateUser(@PathVariable("id") UUID id, @Valid @RequestBody UserDetail userDetail){
        return userDetailsRepository.findById(id)
                .map(existingUser -> {
                    existingUser.setName(userDetail.getName());
                    UserDetail updatedUser = userDetailsRepository.save(existingUser);
                    return ResponseEntity.ok(updatedUser);
                })
                .orElse(ResponseEntity.notFound().build());
    }


}
