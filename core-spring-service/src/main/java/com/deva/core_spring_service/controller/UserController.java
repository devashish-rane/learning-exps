package com.deva.core_spring_service.controller;


import com.deva.core_spring_service.model.UserDetail;
import com.deva.core_spring_service.repository.UserDetailsRepository;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
@ResponseBody
public class UserController {

    UserDetailsRepository userDetailsRepository;

//    constructure inj implicit
    public UserController(UserDetailsRepository userDetailsRepository){
        this.userDetailsRepository = userDetailsRepository;
    }

    @PostMapping("/user")
    UserDetail postUser(@RequestBody UserDetail userDetail){
        return userDetailsRepository.save(userDetail);
    }
}
