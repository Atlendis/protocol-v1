// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "base64-sol/base64.sol";

import "./interfaces/IPositionManager.sol";
import "./interfaces/IPositionDescriptor.sol";
import "./lib/Errors.sol";

contract PositionDescriptor is IPositionDescriptor {
  mapping(bytes32 => string) internal _poolIdentifiers;

  /**
   * @notice Get the pool identifier corresponding to the input pool hash
   * @param poolHash The identifier of the pool
   **/
  function getPoolIdentifier(bytes32 poolHash) public view override returns (string memory) {
    return _poolIdentifiers[poolHash];
  }

  /**
   * @notice Set the pool string identifier corresponding to the input pool hash
   * @param poolIdentifier The string identifier to associate with the corresponding pool hash
   * @param poolHash The identifier of the pool
   **/
  function setPoolIdentifier(string calldata poolIdentifier, bytes32 poolHash) public override {
    if (keccak256(abi.encode(poolIdentifier)) != poolHash) {
      revert Errors.POD_BAD_INPUT();
    }
    _poolIdentifiers[poolHash] = poolIdentifier;
    emit SetPoolIdentifier(poolIdentifier, poolHash);
  }

  /**
   * @notice Returns the encoded svg for positions artwork
   * @param position The address of the position manager contract
   * @param tokenId The tokenId of the position
   **/
  function tokenURI(IPositionManager position, uint128 tokenId) public view override returns (string memory) {
    (bytes32 poolHash, , uint128 rate, address underlyingToken, , , ) = position.position(tokenId);
    (uint128 bondsQuantity, uint128 normalizedDepositedAmount) = position.getPositionRepartition(tokenId);
    string memory symbol = ERC20Upgradeable(underlyingToken).symbol();

    string memory image = Base64.encode(
      bytes(
        string(
          abi.encodePacked(
            '<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 532 754.5" '
            'style="enable-background:new 0 0 532 754.5;" xml:space="preserve">',
            generateBackground(),
            generateArt(),
            generateAtlendisName(),
            generatePositionMetadata(tokenId, poolHash, symbol, rate, normalizedDepositedAmount, bondsQuantity),
            "</svg>"
          )
        )
      )
    );
    return
      string(
        abi.encodePacked(
          "data:application/json;base64,",
          Base64.encode(
            abi.encodePacked(
              '{"name":"Position #',
              uint2str(tokenId),
              '",'
              '"description":"A Position on the Atlendis protocol for pool ',
              _poolIdentifiers[poolHash],
              ". This NFT represents your share of the pool, its theoritical price depends on the status of the pool, "
              " the amount of tokens you originally deposited and the different rewards allocated to it."
              '"external_url":"https://app.atlendis.io/",'
              '"image": "data:image/svg+xml;base64,',
              image,
              '"}'
            )
          )
        )
      );
  }

  function uint2str(uint128 _i) internal pure returns (string memory str) {
    if (_i == 0) {
      return "0";
    }
    uint128 j = _i;
    uint128 length;
    while (j != 0) {
      length++;
      j /= 10;
    }
    bytes memory bstr = new bytes(length);
    uint128 k = length;
    j = _i;
    while (j != 0) {
      bstr[--k] = bytes1(uint8(48 + (j % 10)));
      j /= 10;
    }
    str = string(bstr);
  }

  function generateBackground() internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<style type="text/css">.st1{fill:none;stroke:#777188;stroke-width:0.5;stroke-miterlimit:10;}'
          ".st2{fill:#777188;}"
          ".st3{fill:#FFFFFF;}"
          ".st4{fill:#FCB4E0;}"
          ".st5{font-family:'Roboto-bold';font-size:16px;}"
          "</style>"
          '<radialGradient id="SVGID_1_" cx="253.4884" cy="417.4284" r="373.2191" '
          'gradientTransform="matrix(0.8986 0 0 0.8633 38.203 16.8953)" gradientUnits="userSpaceOnUse">'
          '<stop  offset="0" style="stop-color:#3A003F"/><stop  offset="1" style="stop-color:#0A002A"/></radialGradient>'
          '<path style="fill:url(#SVGID_1_);stroke:#FFFFFF;stroke-width:0.4404;stroke-miterlimit:10;" '
          'd="M0,749.9V4.6C0,2.1,2.1,0,4.6,0h522.8c2.5,0,4.6,2.1,4.6,4.6v745.3c0,2.5-2.1,4.6-4.6,4.6H4.6C2.1,754.5,0,752.4,0,749.9z"/>'
          '<rect x="27.3" y="61.4" class="st1" width="477.8" height="572.9"/>'
          '<line class="st1" x1="27.3" y1="538.7" x2="505.1" y2="538.7"/>'
          '<line class="st1" x1="27.3" y1="443.6" x2="505.1" y2="443.6"/>'
          '<line class="st1" x1="27.3" y1="348.1" x2="505.1" y2="348.1"/>'
          '<line class="st1" x1="27.3" y1="252.5" x2="505.1" y2="252.5"/>'
          '<line class="st1" x1="27.3" y1="157" x2="505.1" y2="157"/>'
          '<line class="st1" x1="122.8" y1="61.4" x2="122.8" y2="634.3"/>'
          '<line class="st1" x1="218.4" y1="61.4" x2="218.4" y2="634.3"/>'
          '<line class="st1" x1="314" y1="61.4" x2="314" y2="634.3"/>'
          '<line class="st1" x1="409.5" y1="61.4" x2="409.5" y2="634.3"/>'
          '<circle class="st2" cx="409.5" cy="157" r="5.4"/>'
          '<circle class="st2" cx="505.1" cy="347.8" r="5.4"/>'
          '<circle class="st2" cx="27.3" cy="538.7" r="5.4"/>'
          '<circle class="st2" cx="27.3" cy="156.4" r="5.4"/>'
        )
      );
  }

  function generateArt() internal pure returns (string memory) {
    return string(abi.encodePacked(generateTopPlanets(), generateCenterPlanets(), generateDownPlanets()));
  }

  function generateTopPlanets() internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<linearGradient id="1" gradientUnits="userSpaceOnUse" x1="502.8664" y1="485.6057" x2="587.8019" '
          'y2="485.6057" gradientTransform="matrix(-0.7096 -0.7046 0.7046 -0.7096 147.9199 858.1921)">'
          '<stop  offset="0" style="stop-color:#FAB2DE"/><stop  offset="1" style="stop-color:#0000FF"/>'
          '</linearGradient><circle style="fill:url(#1);" cx="103.1" cy="129.4" r="42.5"/>'
          '<linearGradient id="2" gradientUnits="userSpaceOnUse" x1="4853.835" y1="984.5833" x2="4854.8218" '
          'y2="1023.5588" gradientTransform="matrix(-0.9772 -0.2123 0.2123 -0.9772 4667.0605 2228.1553)">'
          '<stop  offset="0" style="stop-color:#00FFFF"/><stop  offset="1" style="stop-color:#FFFF00"/>'
          '</linearGradient><circle style="fill:url(#2);" cx="136.7" cy="215.3" r="19"/>'
          '<linearGradient id="3" gradientUnits="userSpaceOnUse" x1="697.1088" y1="685.6257" x2="784.6827" '
          'y2="685.6257" gradientTransform="matrix(-2.0426 0.6767 -0.7431 -0.8353 2272.0312 264.6844)">'
          '<stop offset="0" style="stop-color:#00FFFF"/><stop  offset="1" style="stop-color:#9DFC92"/></linearGradient>'
          '<line style="fill:none;stroke:url(#3);stroke-width:4.142;stroke-linecap:round;stroke-linejoin:round;'
          'stroke-miterlimit:10;" x1="342.6" y1="174.2" x2="155.9" y2="212.4"/><linearGradient id="4" '
          'gradientUnits="userSpaceOnUse" x1="348.7628" y1="119.7764" x2="350.8899" y2="203.7983">'
          '<stop  offset="0" style="stop-color:#00FFFF"/><stop  offset="1" style="stop-color:#0000FF"/>'
          '</linearGradient><circle style="fill:url(#4);" cx="350" cy="166.8" r="41"/><circle style="fill:#FFFF00;" '
          'cx="354.8" cy="70" r="5.9"/>'
          '<linearGradient id="5" gradientUnits="userSpaceOnUse" x1="140.7756" y1="230.1122" x2="228.9412" y2="230.1122">'
          '<stop  offset="0" style="stop-color:#9DFC92"/><stop  offset="1" style="stop-color:#FF7BAC"/></linearGradient>'
          '<line style="fill:none;stroke:url(#5);stroke-width:4.7337;stroke-linecap:round;stroke-linejoin:round;'
          'stroke-miterlimit:10;" x1="143.1" y1="219.2" x2="226.6" y2="241.1"/>'
          '<linearGradient id="6" gradientUnits="userSpaceOnUse" x1="695.0284" y1="812.7755" x2="783.7858" '
          'y2="812.7755" gradientTransform="matrix(-1.1737 0.9697 -0.8244 -0.6412 1822.474 11.7986)">',
          '<stop  offset="0" style="stop-color:#353DF7"/><stop  offset="1" style="stop-color:#FF7BAC"/></linearGradient>'
          '<line style="fill:none;stroke:url(#6);stroke-width:5.3254;stroke-linecap:round;stroke-linejoin:'
          'round;stroke-miterlimit:10;" x1="342.6" y1="174.2" x2="226.6" y2="241.1"/>'
        )
      );
  }

  function generateCenterPlanets() internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<circle style="fill:#0000FF" cx="114" cy="320" r="38"/>'
          '<linearGradient id="7" gradientUnits="userSpaceOnUse" x1="279.8008" y1="1203.038" x2="578.9129" '
          'y2="1203.038" gradientTransform="matrix(0 1 -1 0 1444.4052 -54.4462)">'
          '<stop  offset="0" style="stop-color:#FAB2DE"/><stop  offset="1" style="stop-color:#0000FF"/>'
          '</linearGradient><circle style="fill:url(#7);" cx="241.4" cy="374.9" r="149.6"/>'
          '<linearGradient id="8" gradientUnits="userSpaceOnUse" x1="202.9501" y1="390.4209" x2="109.6353" y2="483.7357">'
          '<stop  offset="0" style="stop-color:#0B0443"/><stop  offset="0.5173" style="stop-color:#1B1464"/>'
          '<stop  offset="1" style="stop-color:#2E3190"/></linearGradient>'
          '<path style="fill:url(#8);" d="M207.8,399.6c27.7,41.8,31.5,88,8.6,103.2c-23,'
          '15.2-64-6.3-91.7-48.1s-31.5-88-8.6-103.2C139,336.3,180.1,357.9,207.8,399.6z"/>'
          '<linearGradient id="9" gradientUnits="userSpaceOnUse" x1="705.8905" y1="841.9223" x2="797.4905" '
          'y2="841.9223" gradientTransform="matrix(-0.7071 0.7071 -0.7071 -0.7071 1263.1495 522.8206)">'
          '<stop  offset="0.2165" style="stop-color:#FAB2DE"/><stop  offset="1" style="stop-color:#00FFFF"/>'
          '</linearGradient><circle style="fill:url(#9);" cx="136.3" cy="459" r="45.8"/>'
          '<linearGradient id="10" gradientUnits="userSpaceOnUse" x1="1589.9778" y1="817.77" x2="1605.3485" '
          'y2="860.5405" gradientTransform="matrix(-0.9832 -0.1825 0.1825 -0.9832 1799.8251 1471.0231)">'
          '<stop  offset="0" style="stop-color:#0B0443"/><stop  offset="0.5173" style="stop-color:#1B1464"/>'
          '<stop  offset="1" style="stop-color:#2E3190"/></linearGradient><circle style="fill:url(#10);" cx="381.4" cy="349.8" r="22.1"/>'
          '<linearGradient id="11" gradientUnits="userSpaceOnUse" x1="225.6964" y1="201.0739" x2="227.4934" y2="272.0549">'
          '<stop  offset="0" style="stop-color:#FC6EC0"/><stop  offset="1" style="stop-color:#9C005D"/>'
          '</linearGradient><circle style="fill:url(#11);" cx="226.7" cy="240.8" r="34.7"/>'
        )
      );
  }

  function generateDownPlanets() internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<linearGradient id="12" gradientUnits="userSpaceOnUse" x1="484.1273" y1="295.5512" x2="485.3994" '
          'y2="345.7959" gradientTransform="matrix(0.9045 0.4266 -0.4266 0.9045 193.3309 -47.055)">'
          '<stop  offset="0" style="stop-color:#FC6EC0"/><stop  offset="1" style="stop-color:#9C005D"/>'
          '</linearGradient><circle style="fill:url(#12);" cx="493.8" cy="452.5" r="24.5"/>'
          '<linearGradient id="13" gradientUnits="userSpaceOnUse" x1="528.0872" y1="444.3404" x2="529.0894" '
          'y2="483.9227" gradientTransform="matrix(0.9045 0.4266 -0.4266 0.9045 193.3309 -47.055)">'
          '<stop  offset="0" style="stop-color:#00FFFF"/><stop  offset="1" style="stop-color:#0000FF"/>'
          '</linearGradient><circle style="fill:url(#13);" cx="472.5" cy="600.4" r="19.3"/>'
          '<linearGradient id="14" gradientUnits="userSpaceOnUse" x1="1017.4314" y1="453.2621" x2="1106.1887" '
          'y2="453.2621" gradientTransform="matrix(-0.8497 0.1398 -8.259396e-02 -0.9876 1369.6598 893.7979)">'
          '<stop  offset="0" style="stop-color:#4C6FF5"/><stop  offset="0.3634" style="stop-color:#4A4FD1"/>'
          '<stop  offset="1" style="stop-color:#45108A"/></linearGradient>'
          '<line style="fill:none;stroke:url(#14);stroke-width:5.3254;stroke-linecap:round;stroke-linejoin:round;'
          'stroke-miterlimit:10;" x1="466.4" y1="599.5" x2="393.7" y2="589.6"/>'
          '<linearGradient id="15" gradientUnits="userSpaceOnUse" x1="545.4843" y1="617.3547" x2="634.2416" '
          'y2="617.3547" gradientTransform="matrix(-1.1943 1.5673 -1.0482 -0.316 1778.2054 -209.5829)">'
          '<stop  offset="0" style="stop-color:#AA4688"/><stop  offset="1" style="stop-color:#353DF7"/></linearGradient>'
          '<line style="fill:none;stroke:url(#15);stroke-width:5.3254;stroke-linecap:round;stroke-linejoin:round;'
          'stroke-miterlimit:10;" x1="487.9" y1="457.9" x2="365.3" y2="581.7"/>'
          '<linearGradient id="16" gradientUnits="userSpaceOnUse" x1="423.5873" y1="549.3148" x2="424.7167" '
          'y2="443.1502" gradientTransform="matrix(0.9045 0.4266 -0.4266 0.9045 193.3309 -47.055)">',
          '<stop  offset="9.595960e-02" style="stop-color:#381077"/><stop  offset="1" style="stop-color:#7C1DC9"/>'
          '</linearGradient><circle style="fill:url(#16);" cx="365.8" cy="581.6" r="39.3"/>'
        )
      );
  }

  function generateAtlendisName() internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<path class="st3" d="M378.2,30.5l5.4,19.1h-2.3l-0.8-3.1H376l-0.8,3.1h-2.3L378.2,'
          '30.5z M380,44.5l-1.2-4.8l-0.5-2.2l-0.5,2.2l-1.3,4.8H380z"/>'
          '<path class="st3" d="M395.2,33.1h-2.9V31h8v2.1h-2.9v16.5h-2.2V33.1z"/>'
          '<path class="st3" d="M410.6,31h2.2v16.5h4.8v2h-7V31z"/>'
          '<path class="st3" d="M427.5,31h6.2v2.1h-4.1v7.1h3.5v2.1h-3.5v5.3h4.1v2.1h-6.2V31z"/>'
          '<path class="st3" d="M444.6,30.3l5.8,9.7l1.3,2.3l-0.1-2.2V31h2.2v19l-5.9-9.7l-1.3-2l0.1,2v9.3h-2.2V30.3z"/>'
          '<path class="st3" d="M465.3,30.8c1.3,0.1,2.4,0.3,3.5,0.8c1,0.5,1.9,1.1,2.7,1.9c0.7,0.8,1.3,1.8,1.7,'
          "2.9c0.4,1.1,0.6,2.4,0.6,3.9c0,1.4-0.2,2.7-0.6,3.9c-0.4,1.1-1,2.1-1.7,2.9c-0.7,0.8-1.6,1.4-2.7,1.9c-1,0.5-2.2,"
          "0.7-3.5,0.8V30.8z M467.5,47.3c0.5-0.2,1-0.4,1.5-0.7c0.5-0.3,0.9-0.8,1.3-1.4c0.4-0.6,0.7-1.2,0.9-2c0.2-0.8,0.4-1.8,"
          '0.4-2.8c0-1.1-0.1-2-0.4-2.8c-0.2-0.8-0.5-1.5-0.9-2c-0.4-0.6-0.8-1-1.3-1.4c-0.5-0.3-1-0.6-1.5-0.7V47.3z"/>'
          '<path class="st3" d="M484.4,31h2.2v18.6h-2.2V31z"/>'
          '<path class="st3" d="M498,46.8c0.4,0.2,0.8,0.4,1.2,0.6c0.4,0.2,0.9,0.3,1.4,0.3c0.3,0,0.6,0,0.9-0.1s0.5-0.2,0.7-0.4'
          "c0.2-0.2,0.4-0.4,0.5-0.7c0.1-0.3,0.2-0.6,0.2-1c0-0.3,0-0.5-0.1-0.8c-0.1-0.3-0.2-0.6-0.3-0.9c-0.2-0.3-0.3-0.7-0.6-1"
          "c-0.2-0.4-0.5-0.8-0.9-1.2l-1.5-1.9c-0.4-0.5-0.7-0.9-1-1.4c-0.3-0.4-0.5-0.8-0.6-1.2c-0.2-0.4-0.3-0.8-0.4-1.1"
          "c-0.1-0.4-0.1-0.7-0.1-1.1c0-0.6,0.1-1.1,0.3-1.6c0.2-0.5,0.5-0.9,0.8-1.3c0.4-0.4,0.8-0.6,1.3-0.8c0.5-0.2,1.1-0.3,1.7-0.3"
          "c0.5,0,1,0.1,1.6,0.2c0.5,0.1,1,0.4,1.5,0.6l-0.9,1.8c-0.3-0.2-0.6-0.3-0.9-0.4c-0.3-0.1-0.7-0.2-1-0.2c-0.6,0-1.1,0.2-1.5,0.5"
          "c-0.4,0.4-0.6,0.9-0.6,1.5c0,0.2,0,0.4,0.1,0.6c0,0.2,0.1,0.4,0.2,0.6c0.1,0.2,0.2,0.5,0.4,0.7c0.2,0.3,0.4,0.6,0.6,0.9l2.2,2.9"
          "c0.3,0.4,0.5,0.7,0.8,1.1c0.2,0.4,0.5,0.7,0.6,1.1c0.2,0.4,0.3,0.8,0.4,1.2c0.1,0.4,0.2,0.8,0.2,1.3c0,0.7-0.1,1.3-0.3,1.9"
          "c-0.2,0.6-0.5,1-0.9,1.4c-0.4,0.4-0.9,0.7-1.4,0.9c-0.6,0.2-1.2,0.3-1.8,0.3c-0.7,0-1.3-0.1-2-0.3c-0.6-0.2-1.2-0.5-1.6-0.8"
          'L498,46.8z"/>'
        )
      );
  }

  function generatePositionMetadata(
    uint128 tokenId,
    bytes32 poolHash,
    string memory symbol,
    uint128 rate,
    uint128 normalizedDepositedAmount,
    uint128 bondsQuantity
  ) internal view returns (string memory) {
    return
      string(
        abi.encodePacked(
          generatePositionId(tokenId),
          generatePoolName(poolHash),
          generatePoolRate(rate),
          generatePoolAmounts(symbol, normalizedDepositedAmount, bondsQuantity)
        )
      );
  }

  function generatePositionId(uint128 tokenId) internal pure returns (string memory) {
    return
      string(
        abi.encodePacked(
          '<linearGradient id="17" gradientUnits="userSpaceOnUse" x1="38.7172" y1="2.7463" x2="102.529" y2="66.5581">'
          '<stop  offset="0.2165" style="stop-color:#FAB2DE"/><stop  offset="1" style="stop-color:#00FFFF"/></linearGradient>'
          '<path style="fill:url(#17);" d="M121.2,54.1H28.8c-0.9,0-1.7-0.7-1.7-1.7V25.5c0-0.9,'
          '0.7-1.7,1.7-1.7h92.4c0.9,0,1.7,0.7,1.7,1.7v26.9C122.8,53.4,122.1,54.1,121.2,54.1z"/>'
          '<text transform="matrix(1 0 0 1 41.9943 43.7106)" class="st5">ID: ',
          uint2str(tokenId),
          "</text>"
        )
      );
  }

  function generatePoolName(bytes32 poolHash) internal view returns (string memory) {
    string memory poolIdentifier = _poolIdentifiers[poolHash];
    return
      string(
        abi.encodePacked(
          '<path class="st1" d="M29.2,642.7h356.7c1.1,0,2.1,1.3,2.1,2.8v24.7c0,1.5-1,2.8-2.1,'
          '2.8H29.2c-1.1,0-2.1-1.3-2.1-2.8v-24.7C27.1,643.9,28,642.7,29.2,642.7z"/>'
          '<text transform="matrix(1 0 0 1 37.5065 663.5427)" class="st3 st5">Pool: ',
          poolIdentifier,
          "</text>"
        )
      );
  }

  function generatePoolRate(uint128 rate) internal pure returns (string memory) {
    uint128 firstSignificantNumberPrecision = 1e16;
    uint128 secondSignificantNumberPrecision = 1e14;
    return
      string(
        abi.encodePacked(
          '<path class="st1" d="M398.1,642.8h104.5c1.1,0,1.9,0.9,1.9,1.9v26.4c0,1.1-0.9,1.9-1.9,'
          '1.9H398.1c-1.1,0-1.9-0.9-1.9-1.9v-26.4C396.2,643.7,397.1,642.8,398.1,642.8z"/>'
          '<text transform="matrix(1 0 0 1 420.3261 662.4679)" class="st3 st5">I.R. ',
          uint2str(rate / firstSignificantNumberPrecision),
          ".",
          uint2str((rate % firstSignificantNumberPrecision) / secondSignificantNumberPrecision),
          "%</text>"
        )
      );
  }

  function generatePoolAmounts(
    string memory symbol,
    uint128 normalizedDepositedAmount,
    uint128 bondsQuantity
  ) internal pure returns (string memory) {
    uint128 firstSignificantNumberPrecision = 1e18;
    uint128 secondSignificantNumberPrecision = 1e16;
    return
      string(
        abi.encodePacked(
          '<path class="st1" d="M259.8,711.6H29.9c-1.3,0-2.3-1.6-2.3-3.5v-23.2c0-2,1-3.5,'
          '2.3-3.5h229.9c1.3,0,2.3,1.6,2.3,3.5v23.2C262.1,710,261,711.6,259.8,711.6z"/>'
          '<text transform="matrix(1 0 0 1 38.0304 702.1925)" class="st3 st5">',
          uint2str(normalizedDepositedAmount / firstSignificantNumberPrecision),
          ".",
          uint2str((normalizedDepositedAmount % firstSignificantNumberPrecision) / secondSignificantNumberPrecision),
          symbol,
          ' Deposited </text><path class="st1" d="M501.8,711.6H271.2c-1.3,0-2.3-1.6-2.3-3.5v-23.2c0-2,'
          '1-3.5,2.3-3.5h230.7c1.3,0,2.3,1.6,2.3,3.5v23.2C504.1,710,503.1,711.6,501.8,711.6z"/>'
          '<text transform="matrix(1 0 0 1 278.8931 702.1919)" class="st3 st5">',
          uint2str(bondsQuantity / firstSignificantNumberPrecision),
          ".",
          uint2str((bondsQuantity % firstSignificantNumberPrecision) / secondSignificantNumberPrecision),
          symbol,
          " Borrowed </text>"
        )
      );
  }
}
