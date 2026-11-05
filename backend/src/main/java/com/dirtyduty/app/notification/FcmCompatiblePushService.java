package com.dirtyduty.app.notification;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.apache.http.Header;
import org.apache.http.client.methods.HttpPost;
import org.jose4j.lang.JoseException;

final class FcmCompatiblePushService extends PushService {
  FcmCompatiblePushService(String publicKey, String privateKey, String subject)
      throws GeneralSecurityException {
    super(publicKey, privateKey, subject);
  }

  FcmCompatiblePushService(KeyPair keyPair, String subject) {
    super(keyPair, subject);
  }

  @Override
  public HttpPost preparePost(Notification notification, Encoding encoding)
      throws GeneralSecurityException, IOException, JoseException {
    HttpPost request = super.preparePost(notification, encoding);
    Header cryptoKey = request.getFirstHeader("Crypto-Key");
    if (cryptoKey != null) {
      // web-push 5.1.2 pads p256ecdsa, which FCM rejects; keep the correction at the request
      // boundary.
      request.setHeader("Crypto-Key", removeP256EcdsaPadding(cryptoKey.getValue()));
    }
    return request;
  }

  private static String removeP256EcdsaPadding(String cryptoKey) {
    String[] parameters = cryptoKey.split(";", -1);
    for (int i = 0; i < parameters.length; i++) {
      int separator = parameters[i].indexOf('=');
      if (separator < 0 || !"p256ecdsa".equals(parameters[i].substring(0, separator).trim())) {
        continue;
      }

      int suffixStart = parameters[i].length();
      while (suffixStart > separator + 1
          && Character.isWhitespace(parameters[i].charAt(suffixStart - 1))) {
        suffixStart--;
      }
      int valueEnd = suffixStart;
      while (valueEnd > separator + 1 && parameters[i].charAt(valueEnd - 1) == '=') {
        valueEnd--;
      }
      parameters[i] = parameters[i].substring(0, valueEnd) + parameters[i].substring(suffixStart);
    }
    return String.join(";", parameters);
  }
}
