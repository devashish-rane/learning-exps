package com.deva.core_spring_service;

import com.deva.core_spring_service.service.Ops;
import org.junit.Assert;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class CoreSpringServiveApplicationTests {

    @Autowired
    Ops ops;

	@Test
	void contextLoads() {

	}

    @Test
    void firstUnit() {
        assertEquals(5,ops.sum(2,3));
    }

}
