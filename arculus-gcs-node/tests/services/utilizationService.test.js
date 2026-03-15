const utilizationService = require('../../services/utilizationService');
const fs = require('fs');

jest.mock('fs', () => ({
    promises: {
        writeFile: jest.fn()
    }
}));

describe('utilizationService', () => {
    let mockReq;
    let mockRes;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {};
        mockRes = {
            json: jest.fn()
        };
    });

    describe('getUtilizationApi', () => {
        it('should return an array of utilization data', () => {
            utilizationService.getUtilizationApi(mockReq, mockRes);
            expect(mockRes.json).toHaveBeenCalledWith(expect.any(Array));
        });
    });

    describe('saveUtilizationDataToCSV', () => {
        it('should handle successful CSV save', async () => {
            fs.promises.writeFile.mockResolvedValue();

            await utilizationService.saveUtilizationDataToCSV(mockReq, mockRes);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('utilization_data_'),
                expect.stringContaining('CPU Utilization (%),RAM Utilization (%)')
            );
            expect(mockRes.json).toHaveBeenCalledWith({ message: "Success" });
        });

        it('should handle error during CSV save', async () => {
            const mockError = new Error('File system error');
            fs.promises.writeFile.mockRejectedValue(mockError);
            console.error = jest.fn();

            await utilizationService.saveUtilizationDataToCSV(mockReq, mockRes);

            expect(console.error).toHaveBeenCalledWith('Error saving utilization data to CSV:', mockError);
            expect(mockRes.json).toHaveBeenCalledWith({ message: "Internal Server Error" });
        });
    });
});
