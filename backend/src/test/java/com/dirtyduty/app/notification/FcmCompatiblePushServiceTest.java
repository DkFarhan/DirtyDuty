package com.dirtyduty.app.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Security;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import nl.martijndwars.webpush.Utils;
import org.apache.http.client.methods.HttpPost;
import org.bouncycastle.jce.interfaces.ECPublicKey;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.jose4j.jws.JsonWebSignature;
import org.junit.jupiter.api.Test;

class FcmCompatiblePushServiceTest {
  @Test
  void removesPaddingOnlyFromVapidCryptoKeyAndKeepsAes128GcmAuthorizationValid() throws Exception {
    Security.addProvider(new BouncyCastleProvider());
    KeyPair vapidKeyPair = generateKeyPair();
    KeyPair subscriptionKeyPair = generateKeyPair();
    byte[] subscriptionAuth = new byte[16];
    new SecureRandom().nextBytes(subscriptionAuth);
    Notification notification =
        new Notification(
            "https://push.example.test/send",
            (ECPublicKey) subscriptionKeyPair.getPublic(),
            subscriptionAuth,
            "test payload".getBytes(),
            3600);

    HttpPost originalRequest =
        new PushService(vapidKeyPair, "mailto:push@example.test")
            .preparePost(notification, Encoding.AES128GCM);
    HttpPost correctedRequest =
        new FcmCompatiblePushService(vapidKeyPair, "mailto:push@example.test")
            .preparePost(notification, Encoding.AES128GCM);

    byte[] vapidPublicKey = Utils.encode((ECPublicKey) vapidKeyPair.getPublic());
    Map<String, String> originalCryptoKey =
        parameters(originalRequest.getFirstHeader("Crypto-Key").getValue());
    Map<String, String> correctedCryptoKey =
        parameters(correctedRequest.getFirstHeader("Crypto-Key").getValue());
    assertThat(originalCryptoKey.get("p256ecdsa"))
        .isEqualTo(Base64.getUrlEncoder().encodeToString(vapidPublicKey))
        .endsWith("=");
    assertThat(correctedCryptoKey.get("p256ecdsa"))
        .isEqualTo(Base64.getUrlEncoder().withoutPadding().encodeToString(vapidPublicKey))
        .doesNotEndWith("=");
    assertThat(Base64.getUrlDecoder().decode(correctedCryptoKey.get("p256ecdsa")))
        .isEqualTo(vapidPublicKey);
    originalCryptoKey.remove("p256ecdsa");
    correctedCryptoKey.remove("p256ecdsa");
    assertThat(correctedCryptoKey).isEqualTo(originalCryptoKey);
    assertThat(correctedRequest.getFirstHeader("Content-Encoding").getValue())
        .isEqualTo("aes128gcm");

    String authorization = correctedRequest.getFirstHeader("Authorization").getValue();
    assertThat(authorization).startsWith("vapid t=").contains(", k=");
    String[] authorizationParameters =
        authorization.substring("vapid t=".length()).split(", k=", 2);
    assertThat(Base64.getUrlDecoder().decode(authorizationParameters[1])).isEqualTo(vapidPublicKey);
    JsonWebSignature signature = new JsonWebSignature();
    signature.setCompactSerialization(authorizationParameters[0]);
    signature.setKey(vapidKeyPair.getPublic());
    assertThat(signature.verifySignature()).isTrue();
  }

  private static KeyPair generateKeyPair() throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("ECDH", "BC");
    generator.initialize(new ECGenParameterSpec("secp256r1"));
    return generator.generateKeyPair();
  }

  private static Map<String, String> parameters(String header) {
    Map<String, String> parameters = new LinkedHashMap<>();
    for (String parameter : header.split(";")) {
      String[] parts = parameter.split("=", 2);
      parameters.put(parts[0], parts[1]);
    }
    return parameters;
  }
}
