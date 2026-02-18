// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title InvestmentNFT
 * @dev NFT contract where each token represents an investment in a project
 * NFT value is dynamic and reflects the current value of the investment
 */
contract InvestmentNFT is ERC721URIStorage, AccessControl {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    struct InvestmentData {
        string projectId;           // MongoDB project ID
        address investor;           // Current owner
        uint256 initialAmount;      // Original investment amount
        uint256 currentValue;       // Current value (updated as project grows)
        uint256 investmentDate;     // Timestamp of investment
        bool isActive;              // Whether investment is still active
        string investmentId;        // MongoDB investment record ID
    }

    // Mappings
    mapping(uint256 => InvestmentData) public investments;
    mapping(string => uint256[]) public projectToNFTs;      // projectId => tokenIds
    mapping(address => uint256[]) public investorToNFTs;    // investor => tokenIds
    mapping(string => uint256) public investmentIdToTokenId; // investmentId => tokenId

    // Events
    event NFTMinted(
        uint256 indexed tokenId,
        string projectId,
        address indexed investor,
        uint256 amount,
        string investmentId
    );
    
    event ValueUpdated(
        uint256 indexed tokenId,
        uint256 oldValue,
        uint256 newValue,
        uint256 timestamp
    );
    
    event NFTTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint256 timestamp
    );

    event InvestmentDeactivated(uint256 indexed tokenId, uint256 timestamp);

    constructor() ERC721("Truden Investment NFT", "TINV") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(MINTER_ROLE, msg.sender);
        _setupRole(UPDATER_ROLE, msg.sender);
    }

    /**
     * @dev Mint a new investment NFT
     * @param investor Address of the investor
     * @param projectId Project identifier
     * @param amount Investment amount in wei
     * @param metadataURI IPFS URI for NFT metadata
     * @param investmentId Backend investment record ID
     */
    function mintInvestmentNFT(
        address investor,
        string memory projectId,
        uint256 amount,
        string memory metadataURI,
        string memory investmentId
    ) public onlyRole(MINTER_ROLE) returns (uint256) {
        require(investor != address(0), "Invalid investor address");
        require(amount > 0, "Amount must be greater than 0");
        require(bytes(projectId).length > 0, "Project ID required");
        require(bytes(investmentId).length > 0, "Investment ID required");

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(investor, newTokenId);
        _setTokenURI(newTokenId, metadataURI);

        investments[newTokenId] = InvestmentData({
            projectId: projectId,
            investor: investor,
            initialAmount: amount,
            currentValue: amount,
            investmentDate: block.timestamp,
            isActive: true,
            investmentId: investmentId
        });

        projectToNFTs[projectId].push(newTokenId);
        investorToNFTs[investor].push(newTokenId);
        investmentIdToTokenId[investmentId] = newTokenId;

        emit NFTMinted(newTokenId, projectId, investor, amount, investmentId);
        return newTokenId;
    }

    /**
     * @dev Update the current value of an investment NFT
     * @param tokenId The NFT token ID
     * @param newValue New value in wei
     */
    function updateInvestmentValue(uint256 tokenId, uint256 newValue) 
        public 
        onlyRole(UPDATER_ROLE) 
    {
        require(_exists(tokenId), "NFT does not exist");
        require(investments[tokenId].isActive, "Investment is not active");
        
        uint256 oldValue = investments[tokenId].currentValue;
        investments[tokenId].currentValue = newValue;
        
        emit ValueUpdated(tokenId, oldValue, newValue, block.timestamp);
    }

    /**
     * @dev Batch update values for multiple NFTs (gas efficient)
     * @param tokenIds Array of token IDs
     * @param newValues Array of new values
     */
    function batchUpdateValues(uint256[] memory tokenIds, uint256[] memory newValues)
        public
        onlyRole(UPDATER_ROLE)
    {
        require(tokenIds.length == newValues.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (_exists(tokenIds[i]) && investments[tokenIds[i]].isActive) {
                uint256 oldValue = investments[tokenIds[i]].currentValue;
                investments[tokenIds[i]].currentValue = newValues[i];
                emit ValueUpdated(tokenIds[i], oldValue, newValues[i], block.timestamp);
            }
        }
    }

    /**
     * @dev Deactivate an investment (e.g., when project completes or fails)
     * @param tokenId The NFT token ID
     */
    function deactivateInvestment(uint256 tokenId) 
        public 
        onlyRole(UPDATER_ROLE) 
    {
        require(_exists(tokenId), "NFT does not exist");
        investments[tokenId].isActive = false;
        emit InvestmentDeactivated(tokenId, block.timestamp);
    }

    /**
     * @dev Get investment data for a token
     * @param tokenId The NFT token ID
     */
    function getInvestmentData(uint256 tokenId) 
        public 
        view 
        returns (InvestmentData memory) 
    {
        require(_exists(tokenId), "NFT does not exist");
        return investments[tokenId];
    }

    /**
     * @dev Get all NFT token IDs for a project
     * @param projectId The project identifier
     */
    function getProjectNFTs(string memory projectId) 
        public 
        view 
        returns (uint256[] memory) 
    {
        return projectToNFTs[projectId];
    }

    /**
     * @dev Get all NFT token IDs owned by an investor
     * @param investor The investor address
     */
    function getInvestorNFTs(address investor) 
        public 
        view 
        returns (uint256[] memory) 
    {
        return investorToNFTs[investor];
    }

    /**
     * @dev Get token ID from investment ID
     * @param investmentId The backend investment ID
     */
    function getTokenIdByInvestmentId(string memory investmentId)
        public
        view
        returns (uint256)
    {
        return investmentIdToTokenId[investmentId];
    }

    /**
     * @dev Get current value and ROI for an NFT
     * @param tokenId The NFT token ID
     */
    function getInvestmentMetrics(uint256 tokenId)
        public
        view
        returns (
            uint256 initialAmount,
            uint256 currentValue,
            int256 profitLoss,
            uint256 roiPercentage
        )
    {
        require(_exists(tokenId), "NFT does not exist");
        InvestmentData memory data = investments[tokenId];
        
        initialAmount = data.initialAmount;
        currentValue = data.currentValue;
        profitLoss = int256(currentValue) - int256(initialAmount);
        
        if (initialAmount > 0) {
            roiPercentage = ((currentValue - initialAmount) * 100) / initialAmount;
        } else {
            roiPercentage = 0;
        }
        
        return (initialAmount, currentValue, profitLoss, roiPercentage);
    }

    /**
     * @dev Override transferFrom to update investor mapping
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override(ERC721, IERC721) {
        super.transferFrom(from, to, tokenId);
        
        // Update investor in investment data
        investments[tokenId].investor = to;
        
        // Add to new investor's list
        investorToNFTs[to].push(tokenId);
        
        emit NFTTransferred(tokenId, from, to, block.timestamp);
    }

    /**
     * @dev Override safeTransferFrom
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public virtual override(ERC721, IERC721) {
        super.safeTransferFrom(from, to, tokenId, data);
        
        investments[tokenId].investor = to;
        investorToNFTs[to].push(tokenId);
        
        emit NFTTransferred(tokenId, from, to, block.timestamp);
    }

    /**
     * @dev See {IERC165-supportsInterface}
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Get total number of NFTs minted
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIds.current();
    }
}
